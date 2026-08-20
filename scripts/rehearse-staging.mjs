import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';

const { Pool } = pg;
const port = Number(process.env.STAGING_REHEARSAL_PORT || 8799);
const baseUrl = `http://127.0.0.1:${port}`;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for the staging rehearsal.');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'site-manager-rehearsal-'));
const uploads = path.join(root, 'uploads');
const deploymentState = path.join(root, 'deployments');
const routeDir = path.join(root, 'caddy-sites');
const nnnDist = process.env.NNN_REHEARSAL_DIST_DIR ? path.resolve(process.env.NNN_REHEARSAL_DIST_DIR) : '';
const nnnRelease = String(process.env.NNN_REHEARSAL_RELEASE || 'nnn-rehearsal-ci');
const email = `rehearsal-${Date.now()}@example.test`;
const password = 'Rehearsal-Only-42!';
const rehearsalDomain = `rehearsal-${Date.now()}.available.test`;
const pool = new Pool({ connectionString: databaseUrl, ssl: false });
let child;
let cookie = '';
let userId = '';
const results = [];

function step(name, details = {}) {
  results.push({ name, ok: true, at: new Date().toISOString(), ...details });
  console.log(`✓ ${name}`);
}

async function request(pathname, { method = 'GET', body, headers = {}, expected = [200] } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${pathname} returned ${response.status}: ${text}`);
  }
  return { response, payload };
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/v2/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Site Manager rehearsal server did not become healthy.');
}

async function validateNnnArtifact() {
  if (!nnnDist) return;
  const raw = await fs.readFile(path.join(nnnDist, 'site-manager-runtime.json'), 'utf8');
  const contract = JSON.parse(raw);
  assert.equal(contract.runtime, 'nnn');
  assert.equal(contract.deployment_model, 'shared-static-runtime');
  assert.equal(Number(contract.contract_version), 2);
  assert.equal(Number(contract.rehearsal_contract_version), 1);
  step('nnn production artifact exposes publishing + rehearsal contract', { contract_version: 2, rehearsal_contract_version: 1 });
}

try {
  await fs.mkdir(uploads, { recursive: true });
  await fs.mkdir(deploymentState, { recursive: true });
  await fs.mkdir(routeDir, { recursive: true });
  await validateNnnArtifact();

  child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      APP_URL: baseUrl,
      NODE_ENV: 'test',
      AUTH_DEV_RETURN_LINKS: 'true',
      DOMAIN_AVAILABILITY_MODE: 'stub',
      DOMAIN_OWNERSHIP_TEST_MODE: 'verified',
      SITE_UPLOAD_DIR: uploads,
      NNN_PREVIEW_URL: 'https://preview.staging.example.test',
      PREVIEW_TTL_MINUTES: '10',
      PLATFORM_SITE_BASE_DOMAIN: 'sites.staging.example.test',
      VPS_PUBLISH_MODE: 'plan',
      VPS_DEPLOYMENT_STATE_DIR: deploymentState,
      CADDY_ROUTE_DIR: routeDir,
      NNN_SHARED_DIST_DIR: nnnDist || path.join(root, 'nnn-current'),
      NNN_RUNTIME_RELEASE: nnnRelease,
      SITE_MANAGER_API_UPSTREAM: `http://127.0.0.1:${port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on('data', chunk => process.stderr.write(`[server] ${chunk}`));
  await waitForHealth();
  step('Site Manager API + PostgreSQL health');

  const registered = await request('/api/v2/auth/register', {
    method: 'POST',
    body: { email, password, display_name: 'Staging Rehearsal' },
    expected: [201],
  });
  const verificationUrl = registered.payload.development_verification_url;
  assert.ok(verificationUrl, 'development verification URL missing');
  const verificationToken = new URL(verificationUrl).searchParams.get('verify_token');
  assert.ok(verificationToken);
  step('account registration produces verification flow');

  const verified = await request('/api/v2/auth/verify-email', {
    method: 'POST',
    body: { token: verificationToken },
  });
  const setCookie = verified.response.headers.get('set-cookie') || '';
  cookie = setCookie.split(';')[0];
  assert.ok(cookie.includes('='), 'session cookie missing after verification');
  userId = verified.payload.user.id;
  assert.ok(userId);
  step('email verification creates authenticated VPS session');

  const searchedDomain = await request('/api/v2/domain-onboarding/check', {
    method: 'POST',
    body: { hostname: rehearsalDomain, registrar: 'namecheap' },
  });
  assert.equal(searchedDomain.payload.intent.availability_status, 'available');
  const purchasedDomain = await request(`/api/v2/domain-onboarding/${searchedDomain.payload.intent.id}/purchase-confirmed`, {
    method: 'POST',
    body: { already_owned: false },
  });
  assert.equal(purchasedDomain.payload.intent.purchase_status, 'confirmed');
  const ownedDomain = await request(`/api/v2/domain-onboarding/${searchedDomain.payload.intent.id}/check-ownership`, { method: 'POST' });
  assert.equal(ownedDomain.payload.verified, true);
  assert.equal(ownedDomain.payload.intent.ownership_status, 'verified');
  step('new customer secures and verifies domain before website creation', { hostname: rehearsalDomain });

  const created = await request('/api/v2/websites', {
    method: 'POST',
    body: { name: 'Rehearsal Alpha', domain_onboarding_id: searchedDomain.payload.intent.id },
    expected: [201],
  });
  const website = created.payload.website;
  assert.ok(website.id && website.site_key);
  assert.equal(website.primary_domain, rehearsalDomain);
  assert.equal(website.subscription.billing_status, 'not_started');
  step('website ownership created from verified domain with billing dormant', { website_id: website.id, site_key: website.site_key });

  await request(`/api/v2/builder/${website.id}/identity`, {
    method: 'PUT',
    body: { name: 'Rehearsal Alpha', brand_name: 'Rehearsal Brand', tagline: 'STAGING CONTRACT TEST', logo_url: '' },
  });
  const colors = {
    primary: '#123456',
    secondary: '#345678',
    nav_background: '#101820',
    nav_text: '#f0f4f8',
    header_background: '#ffffff',
  };
  await request(`/api/v2/builder/${website.id}/appearance`, { method: 'PUT', body: { colors } });
  const navigation = ['dashboard', 'auto_trader', 'analysis_tools', 'calculator'];
  await request(`/api/v2/builder/${website.id}/features`, { method: 'PUT', body: { navigation } });
  await request(`/api/v2/builder/${website.id}/deriv`, {
    method: 'PUT',
    body: { deriv_client_id: 'stagingClient42', deriv_scopes: ['trade', 'application_read'], deriv_environment: 'staging' },
  });
  const completed = await request(`/api/v2/builder/${website.id}/complete`, { method: 'POST' });
  assert.equal(completed.payload.config.configuration_status, 'complete');
  step('five-stage nnn configuration completes');

  const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlKQAAAAASUVORK5CYII=', 'base64');
  const logo = await request(`/api/v2/preview/${website.id}/logo`, {
    method: 'PUT',
    body: onePixelPng,
    headers: { 'content-type': 'image/png' },
  });
  assert.match(logo.payload.logo_url, /^\/uploads\//);
  const logoAsset = await fetch(`${baseUrl}${logo.payload.logo_url}`);
  assert.equal(logoAsset.status, 200);
  step('owner-scoped logo persists and is served from VPS asset path');

  const preview = await request(`/api/v2/preview/${website.id}/session`, { method: 'POST', expected: [201] });
  const previewUrl = new URL(preview.payload.app_preview_url);
  const previewToken = previewUrl.searchParams.get('sm_token');
  assert.ok(previewToken);
  const runtimePreview = await request(`/api/v2/runtime/preview/${encodeURIComponent(website.site_key)}?token=${encodeURIComponent(previewToken)}`);
  assert.equal(runtimePreview.payload.mode, 'preview');
  assert.equal(runtimePreview.payload.site.brand_name, 'Rehearsal Brand');
  assert.equal(runtimePreview.payload.site.logo_url, logo.payload.logo_url);
  assert.deepEqual(runtimePreview.payload.customization.navigation, navigation);
  assert.deepEqual(runtimePreview.payload.customization.colors, colors);
  assert.equal(runtimePreview.payload.deriv.client_id, 'stagingClient42');
  assert.equal(runtimePreview.payload.deployment, null);
  step('private real-template runtime receives current manager configuration');

  await request(`/api/v2/domains/${website.id}/approve-preview`, { method: 'POST' });
  const domainState = await request(`/api/v2/domains/${website.id}`);
  const domain = domainState.payload.domains.find(item => item.kind === 'custom' && item.is_primary);
  assert.ok(domain?.id && domain?.hostname);
  assert.equal(domain.hostname, rehearsalDomain);
  assert.equal(domain.ownership_status, 'verified');
  step('domain-first ownership proof remains attached as primary website hostname', { hostname: domain.hostname });

  // DNS propagation and public TLS are external infrastructure boundaries. In the isolated
  // rehearsal database we advance only those two facts, then return to public APIs for all
  // subsequent readiness/publishing/runtime assertions.
  await pool.query(
    `UPDATE website_domains
        SET routing_status = 'ready', ssl_status = 'eligible', routing_verified_at = NOW(), last_checked_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [domain.id],
  );
  await pool.query(
    `UPDATE websites SET primary_domain = $1, domain_status = 'connected', updated_at = NOW() WHERE id = $2`,
    [domain.hostname, website.id],
  );
  step('external DNS/TLS readiness boundary simulated in isolated staging state');

  const domainsReady = await request(`/api/v2/domains/${website.id}`);
  assert.equal(domainsReady.payload.readiness.deployment_ready, true);
  assert.equal(domainsReady.payload.readiness.billing_required, false);
  step('technical deployment gate passes with no billing requirement');

  const publish = await request(`/api/v2/deployments/${website.id}/publish`, { method: 'POST', expected: [201] });
  assert.equal(publish.payload.deployment.status, 'prepared');
  assert.equal(publish.payload.deployment.publish_mode, 'plan');
  assert.equal(publish.payload.live, false);
  const route = await fs.readFile(publish.payload.deployment.route_path, 'utf8');
  assert.match(route, new RegExp(domain.hostname.replace(/\./g, '\\.')));
  assert.match(route, /\/api\/v2\/runtime\/\*/);
  assert.match(route, /\/uploads\/\*/);
  assert.ok(publish.payload.deployment.route_path.startsWith(deploymentState), 'plan route escaped isolated deployment state');
  step('publisher prepares deterministic shared-nnn route without touching live Caddy');

  // Caddy reload + HTTPS certificate success are external host actions. Simulate the successful
  // apply result so the live runtime API itself can be verified end-to-end against PostgreSQL.
  await pool.query(
    `UPDATE website_deployments
        SET status = 'active', publish_mode = 'apply', activated_at = NOW(), prepared_at = COALESCE(prepared_at, NOW()), updated_at = NOW()
      WHERE id = $1`,
    [publish.payload.deployment.id],
  );
  await pool.query(`UPDATE websites SET status = 'live', deployment_status = 'deployed', updated_at = NOW() WHERE id = $1`, [website.id]);
  await pool.query(`UPDATE website_domains SET ssl_status = 'provisioned', updated_at = NOW() WHERE id = $1`, [domain.id]);
  step('external Caddy/HTTPS apply boundary simulated after plan validation');

  const liveRuntime = await request(`/api/v2/runtime/site?host=${encodeURIComponent(domain.hostname)}`);
  assert.equal(liveRuntime.payload.mode, 'live');
  assert.equal(liveRuntime.payload.site.id, website.site_key);
  assert.equal(liveRuntime.payload.site.brand_name, 'Rehearsal Brand');
  assert.equal(liveRuntime.payload.deployment.status, 'active');
  assert.equal(liveRuntime.payload.deployment.runtime, 'nnn');
  assert.equal(Number(liveRuntime.payload.deployment.contract_version), 2);
  assert.equal(liveRuntime.payload.deployment.runtime_release, nnnRelease);
  assert.equal(liveRuntime.payload.routing.routing_status, 'ready');
  assert.equal(liveRuntime.payload.routing.ssl_status, 'provisioned');
  step('live hostname resolves exact Site Manager → nnn runtime contract');

  const history = await request(`/api/v2/deployments/${website.id}`);
  assert.equal(history.payload.readiness.billing_required, false);
  assert.equal(history.payload.deployments[0].id, publish.payload.deployment.id);
  step('deployment history retains exact release and billing remains deferred');

  const report = {
    rehearsal_contract_version: 1,
    ok: true,
    generated_at: new Date().toISOString(),
    site_manager: { service: 'site-manager-v2', api: baseUrl },
    nnn: { runtime: 'nnn', release: nnnRelease, contract_version: 2, artifact_checked: Boolean(nnnDist) },
    website: { id: website.id, site_key: website.site_key, hostname: domain.hostname },
    domain_first_onboarding: true,
    steps: results,
  };
  const reportDir = process.env.STAGING_REHEARSAL_REPORT_DIR ? path.resolve(process.env.STAGING_REHEARSAL_REPORT_DIR) : path.join(root, 'reports');
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `staging-rehearsal-${Date.now()}.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Staging end-to-end rehearsal passed. Report: ${reportPath}`);
} finally {
  if (child && !child.killed) {
    child.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (userId && process.env.STAGING_REHEARSAL_KEEP_DATA !== 'true') {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
  }
  await pool.end().catch(() => {});
}
