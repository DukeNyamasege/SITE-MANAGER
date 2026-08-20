import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { getPool } from '../server/db.js';
import { hashToken, randomToken } from '../server/security.js';
import {
  applyStagingEdge,
  breakStagingEdgeForDrill,
  checkStagingEdgeHealth,
  deactivateStagingEdge,
  initializeStagingEdgeIdle,
  stagingEdgeSettings,
} from '../server/staging-edge-executor.js';
import { monitorStagingEdgeRuns, recoverStagingEdgeMonitor } from '../server/staging-edge-monitor.js';

const pool = getPool();
const serverPort = Number(process.env.STAGING_REHEARSAL_SERVER_PORT || 18787);
const serverUrl = `http://127.0.0.1:${serverPort}`;
const reportPath = String(process.env.STAGING_EDGE_REHEARSAL_REPORT_PATH || '').trim();
const settings = stagingEdgeSettings();

assert.equal(settings.environment, 'staging');
assert.equal(settings.mode, 'staging');
assert.equal(settings.approved, true);
assert.ok(settings.hostname);
assert.ok(settings.runtimeRelease);
assert.ok(settings.failureDrillAllowed, 'CI staging failure drill must be explicitly enabled.');

let serverChild = null;
let caddyChild = null;
let serverStderr = '';
let caddyStderr = '';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(condition, message, attempts = 60, delay = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await condition()) return;
    } catch {}
    await sleep(delay);
  }
  throw new Error(message);
}

function startSiteManager() {
  const child = spawn(process.execPath, ['server/index.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(serverPort),
      NODE_ENV: 'test',
      APP_URL: serverUrl,
      STAGING_EDGE_MONITOR_INTERVAL_MS: '60000',
    },
  });
  child.stderr.on('data', chunk => { serverStderr += chunk.toString(); });
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise(resolve => {
    const timeout = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
}

async function startCaddy() {
  await initializeStagingEdgeIdle(settings);
  const child = spawn(settings.caddyBin, ['run', '--config', settings.caddyfile, '--adapter', 'caddyfile'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', chunk => { caddyStderr += chunk.toString(); });
  await waitFor(async () => {
    const response = await fetch(`http://${settings.caddyAdmin}/config/`);
    return response.ok;
  }, 'Step 14 Caddy admin endpoint did not become ready.');
  return child;
}

async function waitForServer() {
  await waitFor(async () => {
    const response = await fetch(`${serverUrl}/api/v2/health`);
    return response.ok;
  }, 'Step 14 Site Manager staging server did not become ready.');
}

async function seedRun(canary, website, importItem) {
  const runId = crypto.randomUUID();
  const runtimeToken = randomToken(32);
  const tokenMinutes = Math.max(Number(settings.tokenTtlMinutes), Number(canary.rollback_window_minutes || 15) + 10);
  const tokenExpires = new Date(Date.now() + tokenMinutes * 60 * 1000);
  await pool.query(
    `INSERT INTO website_staging_edge_runs
       (id, canary_execution_id, plan_id, website_id, legacy_import_id, requested_by_user_id,
        status, staging_hostname, held_runtime_commit, runtime_token_hash,
        runtime_token_expires_at, rollback_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,'applying',$7,$8,$9,$10,$11::jsonb)`,
    [runId, canary.id, canary.plan_id, website.id, importItem.id, canary.requested_by_user_id,
      settings.hostname, canary.held_runtime_commit, hashToken(runtimeToken), tokenExpires,
      JSON.stringify(canary.rollback_snapshot || {})],
  );
  return { runId, runtimeToken };
}

async function activateRun(canary, website, importItem) {
  const seeded = await seedRun(canary, website, importItem);
  const applied = await applyStagingEdge({
    runId: seeded.runId,
    runtimeToken: seeded.runtimeToken,
    expectedHeldCommit: canary.held_runtime_commit,
    customerHostname: canary.primary_hostname,
  });
  const health = await checkStagingEdgeHealth({
    runId: seeded.runId,
    expectedSiteKey: website.site_key,
    expectedHeldCommit: canary.held_runtime_commit,
  });
  assert.equal(health.ok, true, JSON.stringify(health));
  assert.equal(health.runtime.mode, 'staging');
  assert.equal(health.runtime.site_id, website.site_key);
  assert.equal(health.runtime.staging_run_id, seeded.runId);

  const deadline = new Date(Date.now() + 15 * 60 * 1000);
  await pool.query(
    `UPDATE website_staging_edge_runs
        SET status = 'monitoring', staging_traffic_changed = TRUE,
            route_snapshot = $1::jsonb, health_snapshot = $2::jsonb,
            route_path = $3, health_url = $4, rollback_deadline = $5,
            last_healthy_at = NOW(), activated_at = NOW(), updated_at = NOW()
      WHERE id = $6`,
    [JSON.stringify(applied.routeSnapshot), JSON.stringify(health), applied.settings.caddyfile, applied.healthUrl, deadline, seeded.runId],
  );
  return { ...seeded, applied, health };
}

const canary = (await pool.query(
  `SELECT e.*, p.rollback_window_minutes, p.rollback_snapshot,
          p.status AS plan_status, p.primary_hostname AS plan_primary_hostname
     FROM website_canary_executions e
     JOIN website_cutover_plans p ON p.id = e.plan_id
    WHERE e.status = 'passed'
    ORDER BY e.passed_at DESC NULLS LAST LIMIT 1`,
)).rows[0];
assert.ok(canary, 'Step 13 must leave a PASSED canary for Step 14.');
assert.equal(canary.plan_status, 'armed');

const website = (await pool.query('SELECT id, site_key, status, deployment_status FROM websites WHERE id = $1', [canary.website_id])).rows[0];
const importItem = (await pool.query(`SELECT * FROM legacy_nnn_site_imports WHERE website_id = $1 AND status = 'assigned' LIMIT 1`, [website.id])).rows[0];
assert.ok(website && importItem);
assert.notEqual(website.status, 'live');
assert.equal(website.deployment_status, 'not_deployed');
assert.notEqual(String(canary.primary_hostname || ''), settings.hostname);

const report = {
  ok: false,
  site: website.site_key,
  staging_hostname: settings.hostname,
  real_caddy_https: false,
  staging_runtime_identity: false,
  restart_recovery: false,
  healthy_window_pass: false,
  forced_failure_automatic_rollback: false,
  production_traffic_changed: false,
  production_cutover_performed: false,
  production_deployments_created: 0,
};

try {
  serverChild = startSiteManager();
  await waitForServer();
  caddyChild = await startCaddy();

  const first = await activateRun(canary, website, importItem);
  report.real_caddy_https = true;
  report.staging_runtime_identity = true;

  // Restart the Site Manager process while the real staging route remains active.
  await stopChild(serverChild);
  serverChild = startSiteManager();
  await waitForServer();
  await waitFor(async () => {
    const row = (await pool.query('SELECT recovered_at FROM website_staging_edge_runs WHERE id = $1', [first.runId])).rows[0];
    return Boolean(row?.recovered_at);
  }, 'Step 14 monitor did not recover the active staging run after Site Manager restart.', 80, 250);
  const recoveryEvents = (await pool.query(
    `SELECT COUNT(*)::int AS count FROM website_staging_edge_events WHERE run_id = $1 AND event_type = 'monitor_recovered'`,
    [first.runId],
  )).rows[0].count;
  assert.ok(recoveryEvents >= 1);
  report.restart_recovery = true;

  // End a healthy observation window and prove the monitor retires the temporary route.
  await pool.query(`UPDATE website_staging_edge_runs SET rollback_deadline = NOW() - INTERVAL '1 second' WHERE id = $1`, [first.runId]);
  await monitorStagingEdgeRuns();
  const passedFirst = (await pool.query('SELECT * FROM website_staging_edge_runs WHERE id = $1', [first.runId])).rows[0];
  assert.equal(passedFirst.status, 'passed');
  assert.equal(passedFirst.staging_traffic_changed, false);
  assert.equal(passedFirst.production_traffic_changed, false);
  report.healthy_window_pass = true;

  // A fresh staging rehearsal deliberately breaks the real Caddy route and must auto-rollback.
  const second = await activateRun(canary, website, importItem);
  await breakStagingEdgeForDrill();
  await monitorStagingEdgeRuns();
  const rolledSecond = (await pool.query('SELECT * FROM website_staging_edge_runs WHERE id = $1', [second.runId])).rows[0];
  assert.equal(rolledSecond.status, 'rolled_back');
  assert.equal(rolledSecond.automatic_rollback, true);
  assert.equal(rolledSecond.staging_traffic_changed, false);
  assert.equal(rolledSecond.production_traffic_changed, false);
  report.forced_failure_automatic_rollback = true;

  const production = (await pool.query('SELECT status, deployment_status FROM websites WHERE id = $1', [website.id])).rows[0];
  assert.notEqual(production.status, 'live');
  assert.equal(production.deployment_status, 'not_deployed');
  const deployments = (await pool.query('SELECT COUNT(*)::int AS count FROM website_deployments WHERE website_id = $1', [website.id])).rows[0].count;
  assert.equal(deployments, 0);
  const stagingRuns = (await pool.query('SELECT * FROM website_staging_edge_runs WHERE website_id = $1', [website.id])).rows;
  assert.ok(stagingRuns.length >= 2);
  assert.ok(stagingRuns.every(row => row.production_traffic_changed === false));
  assert.ok(stagingRuns.every(row => row.production_cutover_performed === false));
  report.production_deployments_created = deployments;
  report.ok = true;

  if (reportPath) await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await deactivateStagingEdge({ reason: 'Step 14 CI rehearsal cleanup.' }).catch(() => {});
  await stopChild(serverChild);
  if (caddyChild && caddyChild.exitCode === null) {
    caddyChild.kill('SIGTERM');
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 3000);
      caddyChild.once('exit', () => { clearTimeout(timeout); resolve(); });
    });
  }
  await pool.end();
  if (!report.ok) {
    if (serverStderr) console.error(serverStderr);
    if (caddyStderr) console.error(caddyStderr);
  }
}
