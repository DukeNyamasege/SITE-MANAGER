import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { getPool } from '../server/db.js';
import { hashToken } from '../server/security.js';

const PORT = 8793;
const baseUrl = `http://127.0.0.1:${PORT}`;
const pool = getPool();

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/v2/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Step 12 Site Manager test server did not become healthy.');
}

async function seedSession(userId, token, userAgent) {
  await pool.query(
    `INSERT INTO user_sessions (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, '127.0.0.1', NOW() + INTERVAL '1 hour')`,
    [userId, hashToken(token), userAgent],
  );
  return `site_manager_session_v2=${token}`;
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

const admin = (await pool.query(`SELECT id, email FROM users WHERE email = 'migration-admin@example.test' AND role = 'admin' LIMIT 1`)).rows[0];
const owner = (await pool.query(`SELECT id, email FROM users WHERE email = 'legacy-owner@example.test' LIMIT 1`)).rows[0];
assert.ok(admin, 'Step 10 migration administrator must exist.');
assert.ok(owner, 'Step 10 migrated owner must exist.');
const website = (await pool.query(`SELECT id, site_key, deployment_status, status FROM websites WHERE site_key = 'profitempire' AND owner_user_id = $1 LIMIT 1`, [owner.id])).rows[0];
assert.ok(website, 'Profit Empire must be assigned before Step 12.');

const parityReport = (await pool.query(`SELECT id, status, runtime_evidence FROM legacy_nnn_parity_reports WHERE website_id = $1`, [website.id])).rows[0];
assert.ok(parityReport, 'Step 11 parity evidence must exist.');
assert.equal(parityReport.status, 'parity_ready');
assert.equal(parityReport.runtime_evidence.cutover_contract_compatible, true, 'Held nnn must declare Step 12 cutover contract.');
assert.equal(Number(parityReport.runtime_evidence.cutover_contract_version), 1);

const adminCookie = await seedSession(admin.id, 'step12-admin-token', 'step12-admin-ci');
const ownerCookie = await seedSession(owner.id, 'step12-owner-token', 'step12-owner-ci');

const server = spawn(process.execPath, ['server/index.js'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'test',
    APP_URL: baseUrl,
    VPS_PUBLIC_IPV4: process.env.VPS_PUBLIC_IPV4 || '203.0.113.10',
    CUTOVER_PLAN_TTL_MINUTES: '120',
    CUTOVER_ROLLBACK_WINDOW_MINUTES: '30',
  },
});
let stderr = '';
server.stderr.on('data', chunk => { stderr += chunk.toString(); });

try {
  await waitForHealth();

  const denied = await request('/api/v2/admin/cutover', ownerCookie);
  assert.equal(denied.response.status, 403, 'Customers must not operate production cutover plans.');

  const listed = await request('/api/v2/admin/cutover', adminCookie);
  assert.equal(listed.response.status, 200, JSON.stringify(listed.payload));
  assert.equal(listed.payload.execution_enabled, false);
  const listedSite = listed.payload.sites.find(item => item.website.site_key === 'profitempire');
  assert.ok(listedSite);
  assert.equal(listedSite.parity.cutover_ready, true);

  const prepared = await request(`/api/v2/admin/cutover/${website.id}/prepare`, adminCookie, {
    method: 'POST', body: JSON.stringify({ rollback_window_minutes: 30 }),
  });
  assert.equal(prepared.response.status, 201, JSON.stringify(prepared.payload));
  const firstPlan = prepared.payload.plan;
  assert.equal(firstPlan.status, 'prepared');
  assert.equal(firstPlan.current_evaluation.current, true);
  assert.equal(firstPlan.preflight_snapshot.routing_target_configured, true);
  assert.equal(firstPlan.runtime_snapshot.cutover_contract_version, 1);
  assert.equal(firstPlan.runtime_snapshot.cutover_contract_compatible, true);
  assert.equal(firstPlan.rollback_snapshot.legacy_site_id, 'profitempire');
  assert.equal(firstPlan.rollback_snapshot.rollback_window_minutes, 30);
  assert.equal(firstPlan.production_cutover_performed, false);

  let immutableBlocked = false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await client.query(`UPDATE website_cutover_plans SET v2_fingerprint = $1 WHERE id = $2`, ['0'.repeat(64), firstPlan.id]);
    } catch {
      immutableBlocked = true;
    }
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  assert.equal(immutableBlocked, true, 'Cutover snapshot columns must be immutable.');

  const blockedExecution = await request(`/api/v2/admin/cutover/plans/${firstPlan.id}/execute`, adminCookie, { method: 'POST', body: '{}' });
  assert.equal(blockedExecution.response.status, 409);
  assert.equal(blockedExecution.payload.execution_enabled, false);
  assert.equal(blockedExecution.payload.production_cutover_performed, false);

  const armed = await request(`/api/v2/admin/cutover/plans/${firstPlan.id}/arm`, adminCookie, { method: 'POST', body: '{}' });
  assert.equal(armed.response.status, 200, JSON.stringify(armed.payload));
  assert.equal(armed.payload.plan.status, 'armed');
  assert.equal(armed.payload.plan.current_evaluation.current, true);
  assert.equal(armed.payload.execution_enabled, false);

  const originalColors = (await pool.query('SELECT colors FROM website_configs WHERE website_id = $1', [website.id])).rows[0].colors;
  const changedColors = { ...originalColors, primary: originalColors.primary === '#334455' ? '#556677' : '#334455' };
  const changed = await request(`/api/v2/builder/${website.id}/appearance`, ownerCookie, {
    method: 'PUT', body: JSON.stringify({ colors: changedColors }),
  });
  assert.equal(changed.response.status, 200, JSON.stringify(changed.payload));

  const invalidated = await request(`/api/v2/admin/cutover/plans/${firstPlan.id}`, adminCookie);
  assert.equal(invalidated.response.status, 200);
  assert.equal(invalidated.payload.plan.status, 'invalidated');
  assert.equal(invalidated.payload.plan.current_evaluation.current, false);
  assert.ok(invalidated.payload.plan.current_evaluation.blockers.includes('parity_ready'));
  assert.ok(invalidated.payload.plan.current_evaluation.blockers.includes('v2_fingerprint_current'));

  const restored = await request(`/api/v2/builder/${website.id}/appearance`, ownerCookie, {
    method: 'PUT', body: JSON.stringify({ colors: originalColors }),
  });
  assert.equal(restored.response.status, 200);
  const completed = await request(`/api/v2/builder/${website.id}/complete`, ownerCookie, { method: 'POST', body: '{}' });
  assert.equal(completed.response.status, 200);
  const approved = await request(`/api/v2/domains/${website.id}/approve-preview`, ownerCookie, { method: 'POST', body: '{}' });
  assert.equal(approved.response.status, 200);

  const secondPrepared = await request(`/api/v2/admin/cutover/${website.id}/prepare`, adminCookie, {
    method: 'POST', body: JSON.stringify({ rollback_window_minutes: 60 }),
  });
  assert.equal(secondPrepared.response.status, 201, JSON.stringify(secondPrepared.payload));
  const secondPlan = secondPrepared.payload.plan;
  assert.equal(secondPlan.current_evaluation.current, true);
  assert.equal(secondPlan.rollback_window_minutes, 60);

  const importRow = (await pool.query(`SELECT id, source_fingerprint FROM legacy_nnn_site_imports WHERE website_id = $1`, [website.id])).rows[0];
  const originalFingerprint = importRow.source_fingerprint;
  await pool.query(
    `UPDATE legacy_nnn_site_imports SET source_fingerprint = $1, drift_status = 'drifted', updated_at = NOW() WHERE id = $2`,
    ['e'.repeat(64), importRow.id],
  );
  const driftInvalidated = await request(`/api/v2/admin/cutover/plans/${secondPlan.id}`, adminCookie);
  assert.equal(driftInvalidated.payload.plan.status, 'invalidated');
  assert.ok(driftInvalidated.payload.plan.current_evaluation.blockers.includes('source_fingerprint_current'));

  await pool.query(
    `UPDATE legacy_nnn_site_imports SET source_fingerprint = $1, drift_status = 'current', updated_at = NOW() WHERE id = $2`,
    [originalFingerprint, importRow.id],
  );

  const production = (await pool.query(`SELECT deployment_status, status FROM websites WHERE id = $1`, [website.id])).rows[0];
  assert.equal(production.deployment_status, 'not_deployed');
  assert.notEqual(production.status, 'live');
  const deployments = await pool.query(`SELECT COUNT(*)::int AS count FROM website_deployments WHERE website_id = $1`, [website.id]);
  assert.equal(deployments.rows[0].count, 0, 'Step 12 must not create a production deployment.');
  const cutoverRows = await pool.query(`SELECT production_cutover_performed FROM website_cutover_plans WHERE website_id = $1`, [website.id]);
  assert.ok(cutoverRows.rows.every(row => row.production_cutover_performed === false));

  console.log(JSON.stringify({
    ok: true,
    site: 'profitempire',
    admin_boundary: true,
    immutable_plan_snapshot: true,
    cutover_contract_version: 1,
    prepare_requires_parity_ready: true,
    arm_revalidates_current_evidence: true,
    builder_change_invalidates_armed_plan: true,
    source_drift_invalidates_plan: true,
    rollback_snapshot_preserved: true,
    execution_enabled: false,
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
