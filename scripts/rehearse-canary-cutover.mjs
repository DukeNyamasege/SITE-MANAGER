import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { getPool } from '../server/db.js';
import { hashToken } from '../server/security.js';

const PORT = 8794;
const baseUrl = `http://127.0.0.1:${PORT}`;
const pool = getPool();
const reportPath = String(process.env.CANARY_REHEARSAL_REPORT_PATH || '').trim();

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/v2/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Step 13 Site Manager test server did not become healthy.');
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
    headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function prepareAndArm(websiteId, adminCookie) {
  const prepared = await request(`/api/v2/admin/cutover/${websiteId}/prepare`, adminCookie, {
    method: 'POST', body: JSON.stringify({ rollback_window_minutes: 15 }),
  });
  assert.equal(prepared.response.status, 201, JSON.stringify(prepared.payload));
  assert.equal(prepared.payload.plan.runtime_snapshot.canary_contract_version, 1);
  assert.equal(prepared.payload.plan.runtime_snapshot.canary_contract_compatible, true);
  const plan = prepared.payload.plan;
  const armed = await request(`/api/v2/admin/cutover/plans/${plan.id}/arm`, adminCookie, { method: 'POST', body: '{}' });
  assert.equal(armed.response.status, 200, JSON.stringify(armed.payload));
  assert.equal(armed.payload.plan.status, 'armed');
  assert.equal(armed.payload.plan.current_evaluation.current, true);
  return armed.payload.plan;
}

const admin = (await pool.query(`SELECT id FROM users WHERE email = 'migration-admin@example.test' AND role = 'admin' LIMIT 1`)).rows[0];
const owner = (await pool.query(`SELECT id FROM users WHERE email = 'legacy-owner@example.test' LIMIT 1`)).rows[0];
assert.ok(admin, 'Migration administrator must exist before Step 13.');
assert.ok(owner, 'Migrated owner must exist before Step 13.');
const website = (await pool.query(`SELECT id, site_key, status, deployment_status FROM websites WHERE site_key = 'profitempire' AND owner_user_id = $1 LIMIT 1`, [owner.id])).rows[0];
assert.ok(website, 'Profit Empire migrated shadow must exist before Step 13.');

const adminCookie = await seedSession(admin.id, 'step13-admin-token', 'step13-admin-ci');
const ownerCookie = await seedSession(owner.id, 'step13-owner-token', 'step13-owner-ci');
const child = spawn(process.execPath, ['server/index.js'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'test',
    APP_URL: baseUrl,
    VPS_PUBLIC_IPV4: process.env.VPS_PUBLIC_IPV4 || '203.0.113.10',
    CANARY_EXECUTION_MODE: 'simulate',
    CANARY_MIN_OBSERVATION_SECONDS: '0',
  },
});
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk.toString(); });

const report = {
  ok: false,
  site: 'profitempire',
  ordinary_publish_blocked: false,
  one_canary_global_lock: false,
  healthy_canary_monitoring: false,
  rollback_deadline_started_after_health: false,
  manual_rollback_restores_legacy_snapshot: false,
  forced_health_failure_auto_rolls_back: false,
  final_canary_passed: false,
  production_traffic_changed: false,
  production_cutover_performed: false,
  production_deployments_created: 0,
};

try {
  await waitForHealth();

  const canaryState = await request('/api/v2/admin/canary', adminCookie);
  assert.equal(canaryState.response.status, 200, JSON.stringify(canaryState.payload));
  assert.equal(canaryState.payload.mode, 'simulate');
  assert.equal(canaryState.payload.production_execution_available, false);

  const bypass = await request(`/api/v2/deployments/${website.id}/publish`, ownerCookie, { method: 'POST', body: '{}' });
  assert.equal(bypass.response.status, 409, JSON.stringify(bypass.payload));
  assert.equal(bypass.payload.cutover_required, true);
  report.ordinary_publish_blocked = true;

  const firstPlan = await prepareAndArm(website.id, adminCookie);
  const healthy = await request(`/api/v2/admin/canary/plan/${firstPlan.id}/execute`, adminCookie, {
    method: 'POST', body: JSON.stringify({ simulate_failure: false }),
  });
  assert.equal(healthy.response.status, 201, JSON.stringify(healthy.payload));
  assert.equal(healthy.payload.ok, true);
  assert.equal(healthy.payload.execution.status, 'monitoring');
  assert.equal(healthy.payload.execution.production_traffic_changed, false);
  assert.equal(healthy.payload.execution.production_cutover_performed, false);
  assert.ok(healthy.payload.execution.health_snapshot.ok);
  assert.ok(new Date(healthy.payload.execution.rollback_deadline).getTime() > new Date(healthy.payload.execution.health_verified_at).getTime());
  report.healthy_canary_monitoring = true;
  report.rollback_deadline_started_after_health = true;

  const oldUnusedPlan = (await pool.query(
    `SELECT * FROM website_cutover_plans WHERE website_id = $1 AND status = 'invalidated' AND id <> $2 ORDER BY created_at ASC LIMIT 1`,
    [website.id, firstPlan.id],
  )).rows[0];
  assert.ok(oldUnusedPlan, 'Step 12 should leave an invalidated plan available for the global-lock schema rehearsal.');
  let globalLockHeld = false;
  try {
    await pool.query(
      `INSERT INTO website_canary_executions
         (plan_id, website_id, legacy_import_id, requested_by_user_id, mode, status,
          execution_fingerprint, primary_hostname, held_runtime_commit, rollback_snapshot, rollback_window_minutes)
       SELECT $1,$2,i.id,$3,'simulate','activating',$4,$5,$6,'{}'::jsonb,15
         FROM legacy_nnn_site_imports i WHERE i.website_id = $2 AND i.status = 'assigned' LIMIT 1`,
      [oldUnusedPlan.id, website.id, admin.id, 'f'.repeat(64), firstPlan.primary_hostname, firstPlan.held_runtime_commit],
    );
  } catch (error) {
    globalLockHeld = error?.code === '23505';
  }
  assert.equal(globalLockHeld, true, 'Database must reject a second active canary globally.');
  report.one_canary_global_lock = true;

  const manualRollback = await request(`/api/v2/admin/canary/executions/${healthy.payload.execution.id}/rollback`, adminCookie, { method: 'POST', body: '{}' });
  assert.equal(manualRollback.response.status, 200, JSON.stringify(manualRollback.payload));
  assert.equal(manualRollback.payload.execution.status, 'rolled_back');
  assert.equal(manualRollback.payload.execution.automatic_rollback, false);
  const firstPlanAfter = (await pool.query('SELECT status FROM website_cutover_plans WHERE id = $1', [firstPlan.id])).rows[0];
  assert.equal(firstPlanAfter.status, 'invalidated');
  report.manual_rollback_restores_legacy_snapshot = true;

  const secondPlan = await prepareAndArm(website.id, adminCookie);
  const failed = await request(`/api/v2/admin/canary/plan/${secondPlan.id}/execute`, adminCookie, {
    method: 'POST', body: JSON.stringify({ simulate_failure: true }),
  });
  assert.equal(failed.response.status, 201, JSON.stringify(failed.payload));
  assert.equal(failed.payload.ok, false);
  assert.equal(failed.payload.automatic_rollback, true);
  assert.equal(failed.payload.execution.status, 'rolled_back');
  assert.equal(failed.payload.execution.automatic_rollback, true);
  assert.equal(failed.payload.execution.health_snapshot.ok, false);
  report.forced_health_failure_auto_rolls_back = true;

  const thirdPlan = await prepareAndArm(website.id, adminCookie);
  const finalHealthy = await request(`/api/v2/admin/canary/plan/${thirdPlan.id}/execute`, adminCookie, {
    method: 'POST', body: JSON.stringify({ simulate_failure: false }),
  });
  assert.equal(finalHealthy.response.status, 201, JSON.stringify(finalHealthy.payload));
  assert.equal(finalHealthy.payload.execution.status, 'monitoring');
  const passed = await request(`/api/v2/admin/canary/executions/${finalHealthy.payload.execution.id}/pass`, adminCookie, { method: 'POST', body: '{}' });
  assert.equal(passed.response.status, 200, JSON.stringify(passed.payload));
  assert.equal(passed.payload.execution.status, 'passed');
  assert.equal(passed.payload.production_traffic_changed, false);
  assert.equal(passed.payload.production_cutover_performed, false);
  report.final_canary_passed = true;

  const production = (await pool.query('SELECT status, deployment_status FROM websites WHERE id = $1', [website.id])).rows[0];
  assert.notEqual(production.status, 'live');
  assert.equal(production.deployment_status, 'not_deployed');
  const deployments = (await pool.query('SELECT COUNT(*)::int AS count FROM website_deployments WHERE website_id = $1', [website.id])).rows[0].count;
  assert.equal(deployments, 0, 'Step 13 must not create production website_deployments.');
  const executions = (await pool.query('SELECT * FROM website_canary_executions WHERE website_id = $1 ORDER BY created_at', [website.id])).rows;
  assert.ok(executions.length >= 3);
  assert.ok(executions.every(row => row.mode === 'simulate'));
  assert.ok(executions.every(row => row.production_traffic_changed === false));
  assert.ok(executions.every(row => row.production_cutover_performed === false));
  report.production_deployments_created = deployments;
  report.ok = true;

  if (reportPath) await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 3000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
  await pool.end();
  if (!report.ok && stderr) console.error(stderr);
}
