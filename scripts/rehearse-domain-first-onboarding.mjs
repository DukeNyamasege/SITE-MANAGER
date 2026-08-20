import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { getPool } from '../server/db.js';
import { hashToken } from '../server/security.js';

const PORT = 8794;
const baseUrl = `http://127.0.0.1:${PORT}`;
const pool = getPool();
const email = 'domain-first-customer@example.test';
const token = 'domain-first-session-token';
const userAgent = 'domain-first-ci';
let userId = '';

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/v2/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Domain-first test server did not become healthy.');
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Cookie: `site_manager_session_v2=${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

await pool.query('DELETE FROM users WHERE LOWER(email) = LOWER($1)', [email]);
userId = (await pool.query(
  `INSERT INTO users (email, password_hash, display_name, email_verified_at)
   VALUES ($1, 'domain-first-test-hash', 'Domain First Customer', NOW()) RETURNING id`,
  [email],
)).rows[0].id;
await pool.query(
  `INSERT INTO user_sessions (user_id, token_hash, user_agent, ip_address, expires_at)
   VALUES ($1,$2,$3,'127.0.0.1',NOW() + INTERVAL '1 hour')`,
  [userId, hashToken(token), userAgent],
);

const server = spawn(process.execPath, ['server/index.js'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'test',
    APP_URL: baseUrl,
    DOMAIN_AVAILABILITY_MODE: 'stub',
    DOMAIN_OWNERSHIP_TEST_MODE: 'verified',
  },
});
let stderr = '';
server.stderr.on('data', chunk => { stderr += chunk.toString(); });

try {
  await waitForHealth();

  const initial = await request('/api/v2/domain-onboarding');
  assert.equal(initial.response.status, 200);
  assert.equal(initial.payload.requires_domain_first, true, 'A brand-new customer must enter domain-first onboarding.');

  const blockedWebsite = await request('/api/v2/websites', {
    method: 'POST', body: JSON.stringify({ name: 'Bypass Attempt' }),
  });
  assert.equal(blockedWebsite.response.status, 409, 'Website API must reject creation without a verified domain.');
  assert.equal(blockedWebsite.payload.code, 'domain_first_required');

  const premium = await request('/api/v2/domain-onboarding/check', {
    method: 'POST', body: JSON.stringify({ hostname: 'duke.premium.test', registrar: 'namecheap' }),
  });
  assert.equal(premium.response.status, 200, JSON.stringify(premium.payload));
  assert.equal(premium.payload.intent.availability_status, 'available');
  assert.equal(premium.payload.intent.is_premium, true);
  assert.equal(premium.payload.intent.premium_registration_price, 12500);
  assert.equal(premium.payload.intent.premium_renewal_price, 12500);

  const taken = await request('/api/v2/domain-onboarding/check', {
    method: 'POST', body: JSON.stringify({ hostname: 'duke.taken.test', registrar: 'namecheap' }),
  });
  assert.equal(taken.response.status, 200);
  assert.equal(taken.payload.intent.availability_status, 'registered');
  const cannotBuyTaken = await request(`/api/v2/domain-onboarding/${taken.payload.intent.id}/purchase-confirmed`, {
    method: 'POST', body: JSON.stringify({ already_owned: false }),
  });
  assert.equal(cannotBuyTaken.response.status, 409, 'A taken domain cannot be treated as a new purchase.');

  const available = await request('/api/v2/domain-onboarding/check', {
    method: 'POST', body: JSON.stringify({ hostname: 'duke.available.test', registrar: 'namecheap' }),
  });
  assert.equal(available.response.status, 200, JSON.stringify(available.payload));
  assert.equal(available.payload.intent.availability_status, 'available');
  assert.equal(available.payload.intent.purchase_status, 'not_started');

  const purchased = await request(`/api/v2/domain-onboarding/${available.payload.intent.id}/purchase-confirmed`, {
    method: 'POST', body: JSON.stringify({ already_owned: false }),
  });
  assert.equal(purchased.response.status, 200, JSON.stringify(purchased.payload));
  assert.equal(purchased.payload.intent.purchase_status, 'confirmed');
  assert.equal(purchased.payload.intent.verification_record.type, 'TXT');
  assert.equal(purchased.payload.intent.verification_record.provider_host, '_site-manager-verify');

  const ownership = await request(`/api/v2/domain-onboarding/${available.payload.intent.id}/check-ownership`, {
    method: 'POST', body: '{}',
  });
  assert.equal(ownership.response.status, 200, JSON.stringify(ownership.payload));
  assert.equal(ownership.payload.verified, true);
  assert.equal(ownership.payload.intent.ownership_status, 'verified');
  assert.equal(ownership.payload.intent.status, 'verified');

  const created = await request('/api/v2/websites', {
    method: 'POST',
    body: JSON.stringify({ name: 'Duke', domain_onboarding_id: available.payload.intent.id }),
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.website.name, 'Duke');
  assert.equal(created.payload.website.primary_domain, 'duke.available.test');
  assert.equal(created.payload.website.domain_status, 'pending');

  const attachedDomain = (await pool.query(
    `SELECT hostname, kind, is_primary, ownership_status, routing_status, ssl_status
       FROM website_domains WHERE website_id = $1 LIMIT 1`,
    [created.payload.website.id],
  )).rows[0];
  assert.equal(attachedDomain.hostname, 'duke.available.test');
  assert.equal(attachedDomain.kind, 'custom');
  assert.equal(attachedDomain.is_primary, true);
  assert.equal(attachedDomain.ownership_status, 'verified');
  assert.equal(attachedDomain.routing_status, 'pending');
  assert.equal(attachedDomain.ssl_status, 'pending');

  const claimedIntent = (await pool.query(
    'SELECT status, claimed_website_id FROM domain_onboarding_intents WHERE id = $1',
    [available.payload.intent.id],
  )).rows[0];
  assert.equal(claimedIntent.status, 'claimed');
  assert.equal(claimedIntent.claimed_website_id, created.payload.website.id);

  const reuseBlocked = await request('/api/v2/websites', {
    method: 'POST',
    body: JSON.stringify({ name: 'Second Duke Site', domain_onboarding_id: available.payload.intent.id }),
  });
  assert.equal(reuseBlocked.response.status, 409, 'A verified domain onboarding record can only create one website.');

  const after = await request('/api/v2/domain-onboarding');
  assert.equal(after.response.status, 200);
  assert.equal(after.payload.requires_domain_first, false, 'Once a website exists the automatic first-site redirect is no longer required.');

  console.log(JSON.stringify({
    ok: true,
    domain_first_required_for_new_customer: true,
    direct_website_api_bypass_blocked: true,
    premium_domain_warning_proven: true,
    taken_domain_new_purchase_blocked: true,
    ownership_txt_required: true,
    verified_domain_attached_as_primary: true,
    verified_intent_single_use: true,
    existing_website_flow_preserved: true,
  }, null, 2));
} finally {
  server.kill('SIGTERM');
  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 3000);
    server.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
  if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
  await pool.end();
  if (stderr && process.exitCode) console.error(stderr);
}
