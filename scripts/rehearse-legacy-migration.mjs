import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { getPool } from '../server/db.js';
import { hashToken } from '../server/security.js';

const PORT = 8791;
const baseUrl = `http://127.0.0.1:${PORT}`;
const pool = getPool();

async function seedUser(email, role) {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, display_name, email_verified_at, role)
     VALUES ($1, 'ci-not-a-login-hash', $2, NOW(), $3)
     ON CONFLICT ((LOWER(email))) DO UPDATE SET
       email_verified_at = NOW(), role = EXCLUDED.role, status = 'active', updated_at = NOW()
     RETURNING id, email, role`,
    [email, role === 'admin' ? 'Migration Admin' : 'Legacy Owner', role],
  );
  return result.rows[0];
}

async function sessionCookie(userId, token) {
  await pool.query(
    `INSERT INTO user_sessions (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, 'step10-ci', '127.0.0.1', NOW() + INTERVAL '1 hour')`,
    [userId, hashToken(token)],
  );
  return `site_manager_session_v2=${token}`;
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/v2/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Site Manager test server did not become healthy.');
}

async function request(path, cookie, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

const inventory = await pool.query('SELECT * FROM legacy_nnn_site_imports ORDER BY legacy_site_id');
assert.equal(inventory.rowCount, 13, 'Stable nnn inventory must contain 13 managed sites.');
assert.equal(inventory.rows.filter(row => row.customization_source === 'explicit').length, 4, 'Expected four explicit site customization files.');
assert.equal(inventory.rows.filter(row => row.free_bot_manifest_path).length, 4, 'Expected four site-specific free-bot manifests.');
assert.equal(inventory.rows.filter(row => row.status !== 'unassigned').length, 0, 'Fresh import must not assign ownership automatically.');

const admin = await seedUser('migration-admin@example.test', 'admin');
const customer = await seedUser('legacy-owner@example.test', 'customer');
const adminCookie = await sessionCookie(admin.id, 'migration-admin-token');
const customerCookie = await sessionCookie(customer.id, 'migration-customer-token');

const server = spawn(process.execPath, ['server/index.js'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', APP_URL: baseUrl },
});
let stderr = '';
server.stderr.on('data', chunk => { stderr += chunk.toString(); });

try {
  await waitForHealth();

  const denied = await request('/api/v2/admin/legacy-sites', customerCookie);
  assert.equal(denied.response.status, 403, 'Customer accounts must never access migration inventory.');

  const listed = await request('/api/v2/admin/legacy-sites', adminCookie);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.payload.summary.total, 13);
  assert.equal(listed.payload.summary.assigned, 0);

  const assigned = await request('/api/v2/admin/legacy-sites/profitempire/assign', adminCookie, {
    method: 'POST', body: JSON.stringify({ owner_email: customer.email }),
  });
  assert.equal(assigned.response.status, 201, JSON.stringify(assigned.payload));
  assert.equal(assigned.payload.website.site_key, 'profitempire');
  assert.equal(assigned.payload.website.source, 'migrated');
  assert.equal(assigned.payload.website.status, 'ready');
  assert.equal(assigned.payload.website.deployment_status, 'not_deployed');
  assert.equal(assigned.payload.production_cutover_performed, false);

  const repeated = await request('/api/v2/admin/legacy-sites/profitempire/assign', adminCookie, {
    method: 'POST', body: JSON.stringify({ owner_email: customer.email }),
  });
  assert.equal(repeated.response.status, 200, 'Repeated same-owner assignment must be idempotent.');
  assert.equal(repeated.payload.created, false);

  const website = await pool.query(
    `SELECT w.site_key, w.source, w.status, w.primary_domain, w.domain_status, w.deployment_status,
            c.brand_name, c.navigation, c.colors, c.deriv_client_id, c.configuration_status,
            i.status AS import_status, i.drift_status, i.assigned_source_fingerprint, i.source_fingerprint
       FROM websites w
       JOIN website_configs c ON c.website_id = w.id
       JOIN legacy_nnn_site_imports i ON i.website_id = w.id
      WHERE w.site_key = 'profitempire'`,
  );
  const row = website.rows[0];
  assert.ok(row);
  assert.equal(row.source, 'migrated');
  assert.equal(row.status, 'ready');
  assert.equal(row.deployment_status, 'not_deployed');
  assert.equal(row.domain_status, 'pending');
  assert.equal(row.configuration_status, 'complete');
  assert.equal(row.deriv_client_id, '33DtjQWnmdxRkogkgAOtP');
  assert.equal(row.colors.primary, '#0000ff');
  assert.equal(row.import_status, 'assigned');
  assert.equal(row.drift_status, 'current');
  assert.equal(row.assigned_source_fingerprint, row.source_fingerprint);

  const domains = await pool.query('SELECT hostname, is_primary, ownership_status, routing_status, ssl_status FROM website_domains WHERE website_id = $1 ORDER BY hostname', [assigned.payload.website.id]);
  assert.ok(domains.rowCount >= 2);
  assert.equal(domains.rows.filter(domain => domain.is_primary).length, 1);
  assert.ok(domains.rows.every(domain => domain.ownership_status === 'verified'));
  assert.ok(domains.rows.every(domain => domain.routing_status === 'pending'));
  assert.ok(domains.rows.every(domain => domain.ssl_status === 'pending'));

  console.log(JSON.stringify({
    ok: true,
    inventory_sites: 13,
    assigned_site: 'profitempire',
    preserved_site_key: true,
    preserved_customization: true,
    admin_boundary: true,
    idempotent_assignment: true,
    production_cutover_performed: false,
  }, null, 2));
} finally {
  server.kill('SIGTERM');
  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 3000);
    server.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
  await pool.end();
  if (stderr && process.exitCode) console.error(stderr);
}
