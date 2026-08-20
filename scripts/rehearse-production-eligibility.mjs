import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { getPool } from '../server/db.js';
import { hashToken } from '../server/security.js';

const PORT = 8795;
const baseUrl = `http://127.0.0.1:${PORT}`;
const pool = getPool();
const reportPath = String(process.env.PRODUCTION_ELIGIBILITY_REHEARSAL_REPORT_PATH || '').trim();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/v2/health`);
      if (response.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('Step 15 Site Manager test server did not become healthy.');
}

async function seedSession(userId, token, userAgent) {
  await pool.query(
    `INSERT INTO user_sessions (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1,$2,$3,'127.0.0.1',NOW() + INTERVAL '1 hour')`,
    [userId, hashToken(token), userAgent],
  );
  return `site_manager_session_v2=${token}`;
}

async function request(pathname, cookie, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

const admin = (await pool.query(`SELECT id FROM users WHERE email = 'migration-admin@example.test' AND role = 'admin' LIMIT 1`)).rows[0];
const owner = (await pool.query(`SELECT id FROM users WHERE email = 'legacy-owner@example.test' LIMIT 1`)).rows[0];
assert.ok(admin && owner, 'Step 15 requires the Step 10 migration rehearsal users.');
const website = (await pool.query(
  `SELECT id, site_key, status, deployment_status FROM websites
    WHERE site_key = 'profitempire' AND owner_user_id = $1 LIMIT 1`,
  [owner.id],
)).rows[0];
assert.ok(website, 'Step 15 requires the migrated Profit Empire shadow website.');
const stagingRun = (await pool.query(
  `SELECT * FROM website_staging_edge_runs
    WHERE website_id = $1 AND status = 'passed'
    ORDER BY passed_at DESC NULLS LAST LIMIT 1`,
  [website.id],
)).rows[0];
assert.ok(stagingRun, 'Step 14 must leave a passed real staging-edge rehearsal before Step 15.');
const originalPassedAt = stagingRun.passed_at;

const adminCookie = await seedSession(admin.id, 'step15-admin-token', 'step15-admin-ci');
const ownerCookie = await seedSession(owner.id, 'step15-owner-token', 'step15-owner-ci');
const child = spawn(process.execPath, ['server/index.js'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'test',
    APP_URL: baseUrl,
    PRODUCTION_ELIGIBILITY_TTL_MINUTES: '60',
    PRODUCTION_ELIGIBILITY_STAGING_MAX_AGE_MINUTES: '60',
    STAGING_EDGE_MODE: 'disabled',
  },
});
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk.toString(); });

const report = {
  ok: false,
  site: website.site_key,
  admin_boundary: false,
  baseline_production_eligible: false,
  immutable_evidence: false,
  stale_staging_blocks_approval: false,
  final_approval_current: false,
  execution_hard_blocked: false,
  production_traffic_changed: false,
  production_cutover_performed: false,
  production_deployments_created: 0,
};

try {
  await waitForHealth();

  const ownerDenied = await request('/api/v2/admin/production-eligibility', ownerCookie);
  assert.equal(ownerDenied.response.status, 403, JSON.stringify(ownerDenied.payload));
  report.admin_boundary = true;

  const created = await request(`/api/v2/admin/production-eligibility/website/${website.id}/evaluate`, adminCookie, {
    method: 'POST', body: '{}',
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.record.status, 'eligible');
  assert.equal(created.payload.record.production_eligibility_contract_version, 1);
  assert.equal(created.payload.record.current_evaluation.current, true);
  assert.equal(created.payload.production_execution_available, false);
  assert.equal(created.payload.record.production_traffic_changed, false);
  assert.equal(created.payload.record.production_cutover_performed, false);
  const firstRecord = created.payload.record;
  report.baseline_production_eligible = true;

  let immutableProtected = false;
  try {
    await pool.query(
      `UPDATE website_production_eligibility SET evidence_fingerprint = $1 WHERE id = $2`,
      ['f'.repeat(64), firstRecord.id],
    );
  } catch (error) {
    immutableProtected = String(error?.message || '').includes('Production eligibility evidence is immutable');
  }
  assert.equal(immutableProtected, true, 'Step 15 evidence snapshot must be immutable.');
  report.immutable_evidence = true;

  await pool.query(
    `UPDATE website_staging_edge_runs SET passed_at = NOW() - INTERVAL '2 hours' WHERE id = $1`,
    [stagingRun.id],
  );
  const staleApproval = await request(`/api/v2/admin/production-eligibility/${firstRecord.id}/approve`, adminCookie, {
    method: 'POST', body: '{}',
  });
  assert.equal(staleApproval.response.status, 409, JSON.stringify(staleApproval.payload));
  assert.ok((staleApproval.payload.current_evaluation?.blockers || []).includes('current_evidence_ready')
    || (staleApproval.payload.current_evaluation?.blockers || []).includes('evidence_fingerprint_current'));
  const invalidated = (await pool.query('SELECT status FROM website_production_eligibility WHERE id = $1', [firstRecord.id])).rows[0];
  assert.equal(invalidated.status, 'invalidated');
  report.stale_staging_blocks_approval = true;

  await pool.query('UPDATE website_staging_edge_runs SET passed_at = $1 WHERE id = $2', [originalPassedAt, stagingRun.id]);

  const recreated = await request(`/api/v2/admin/production-eligibility/website/${website.id}/evaluate`, adminCookie, {
    method: 'POST', body: '{}',
  });
  assert.equal(recreated.response.status, 201, JSON.stringify(recreated.payload));
  const secondRecord = recreated.payload.record;
  assert.equal(secondRecord.status, 'eligible');
  assert.notEqual(secondRecord.id, firstRecord.id);

  const approved = await request(`/api/v2/admin/production-eligibility/${secondRecord.id}/approve`, adminCookie, {
    method: 'POST', body: '{}',
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.payload));
  assert.equal(approved.payload.record.status, 'approved');
  assert.equal(approved.payload.record.current_evaluation.current, true);
  assert.equal(approved.payload.record.current_evaluation.approved, true);
  assert.ok(approved.payload.record.approved_at);
  report.final_approval_current = true;

  const execute = await request(`/api/v2/admin/production-eligibility/${secondRecord.id}/execute`, adminCookie, {
    method: 'POST', body: '{}',
  });
  assert.equal(execute.response.status, 409, JSON.stringify(execute.payload));
  assert.equal(execute.payload.production_execution_available, false);
  assert.equal(execute.payload.production_traffic_changed, false);
  assert.equal(execute.payload.production_cutover_performed, false);
  report.execution_hard_blocked = true;

  const production = (await pool.query('SELECT status, deployment_status FROM websites WHERE id = $1', [website.id])).rows[0];
  assert.notEqual(production.status, 'live');
  assert.equal(production.deployment_status, 'not_deployed');
  const deployments = (await pool.query('SELECT COUNT(*)::int AS count FROM website_deployments WHERE website_id = $1', [website.id])).rows[0].count;
  assert.equal(deployments, 0);
  const allRecords = (await pool.query('SELECT * FROM website_production_eligibility WHERE website_id = $1', [website.id])).rows;
  assert.ok(allRecords.length >= 2);
  assert.ok(allRecords.every(row => row.production_traffic_changed === false));
  assert.ok(allRecords.every(row => row.production_cutover_performed === false));
  report.production_deployments_created = deployments;
  report.ok = true;

  if (reportPath) await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await pool.query('UPDATE website_staging_edge_runs SET passed_at = $1 WHERE id = $2', [originalPassedAt, stagingRun.id]).catch(() => {});
  child.kill('SIGTERM');
  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 3000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
  await pool.end();
  if (!report.ok && stderr) console.error(stderr);
}
