import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { getPool } from '../server/db.js';
import { hashToken } from '../server/security.js';

const PORT = 8792;
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
  throw new Error('Step 11 Site Manager test server did not become healthy.');
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

async function startServer() {
  const child = spawn(process.execPath, ['server/index.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', APP_URL: baseUrl },
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  await waitForHealth();
  return { child, stderr: () => stderr };
}

async function stopServer(child) {
  child.kill('SIGTERM');
  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 3000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
}

const owner = (await pool.query(`SELECT id, email FROM users WHERE email = 'legacy-owner@example.test' LIMIT 1`)).rows[0];
assert.ok(owner, 'Step 10 rehearsal owner must exist.');
const website = (await pool.query(`SELECT id FROM websites WHERE site_key = 'profitempire' AND owner_user_id = $1 LIMIT 1`, [owner.id])).rows[0];
assert.ok(website, 'Step 10 must assign profitempire before Step 11 parity rehearsal.');

const token = 'step11-parity-owner-token';
await pool.query(
  `INSERT INTO user_sessions (user_id, token_hash, user_agent, ip_address, expires_at)
   VALUES ($1, $2, 'step11-ci', '127.0.0.1', NOW() + INTERVAL '1 hour')`,
  [owner.id, hashToken(token)],
);
const cookie = `site_manager_session_v2=${token}`;

let server = await startServer();
try {
  const approved = await request(`/api/v2/domains/${website.id}/approve-preview`, cookie, { method: 'POST', body: '{}' });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.payload));
} finally {
  await stopServer(server.child);
}

const parityRun = spawnSync(process.execPath, ['scripts/check-legacy-parity.mjs'], {
  cwd: process.cwd(),
  env: process.env,
  encoding: 'utf8',
});
if (parityRun.status !== 0) throw new Error(`Parity audit failed:\n${parityRun.stdout}\n${parityRun.stderr}`);

server = await startServer();
try {
  const ready = await request(`/api/v2/parity/${website.id}`, cookie);
  assert.equal(ready.response.status, 200, JSON.stringify(ready.payload));
  assert.equal(ready.payload.parity.status, 'parity_ready');
  assert.equal(ready.payload.parity.cutover_ready, true);
  assert.equal(ready.payload.parity.production_cutover_performed, false);
  assert.ok(Object.values(ready.payload.parity.checks).every(Boolean), JSON.stringify(ready.payload.parity.blockers));

  const originalColors = (await pool.query('SELECT colors FROM website_configs WHERE website_id = $1', [website.id])).rows[0].colors;
  const changedColors = { ...originalColors, primary: originalColors.primary === '#123456' ? '#654321' : '#123456' };
  const changed = await request(`/api/v2/builder/${website.id}/appearance`, cookie, {
    method: 'PUT', body: JSON.stringify({ colors: changedColors }),
  });
  assert.equal(changed.response.status, 200, JSON.stringify(changed.payload));
  const approvalAfterEdit = (await pool.query('SELECT preview_approved_at FROM websites WHERE id = $1', [website.id])).rows[0];
  assert.equal(approvalAfterEdit.preview_approved_at, null, 'Builder mutation must invalidate prior preview approval.');

  const blockedAfterEdit = await request(`/api/v2/parity/${website.id}`, cookie);
  assert.equal(blockedAfterEdit.payload.parity.cutover_ready, false);
  assert.ok(blockedAfterEdit.payload.parity.blockers.some(item => item.key === 'colors_match'));
  assert.ok(blockedAfterEdit.payload.parity.blockers.some(item => item.key === 'preview_approved'));

  const restored = await request(`/api/v2/builder/${website.id}/appearance`, cookie, {
    method: 'PUT', body: JSON.stringify({ colors: originalColors }),
  });
  assert.equal(restored.response.status, 200);
  const completed = await request(`/api/v2/builder/${website.id}/complete`, cookie, { method: 'POST', body: '{}' });
  assert.equal(completed.response.status, 200, JSON.stringify(completed.payload));
  const reapproved = await request(`/api/v2/domains/${website.id}/approve-preview`, cookie, { method: 'POST', body: '{}' });
  assert.equal(reapproved.response.status, 200);

  const readyAgain = await request(`/api/v2/parity/${website.id}`, cookie);
  assert.equal(readyAgain.payload.parity.status, 'parity_ready');

  const importRow = (await pool.query(`SELECT id, source_fingerprint FROM legacy_nnn_site_imports WHERE website_id = $1`, [website.id])).rows[0];
  const originalFingerprint = importRow.source_fingerprint;
  await pool.query(
    `UPDATE legacy_nnn_site_imports SET source_fingerprint = $1, drift_status = 'drifted', updated_at = NOW() WHERE id = $2`,
    ['f'.repeat(64), importRow.id],
  );
  const stale = await request(`/api/v2/parity/${website.id}`, cookie);
  assert.equal(stale.payload.parity.status, 'stale');
  assert.equal(stale.payload.parity.checks.runtime_evidence_current, false);
  assert.equal(stale.payload.parity.checks.source_not_drifted, false);

  await pool.query(
    `UPDATE legacy_nnn_site_imports SET source_fingerprint = $1, drift_status = 'current', updated_at = NOW() WHERE id = $2`,
    [originalFingerprint, importRow.id],
  );
  const recovered = await request(`/api/v2/parity/${website.id}`, cookie);
  assert.equal(recovered.payload.parity.status, 'parity_ready');

  const deployment = (await pool.query(`SELECT deployment_status, status FROM websites WHERE id = $1`, [website.id])).rows[0];
  assert.equal(deployment.deployment_status, 'not_deployed');
  assert.notEqual(deployment.status, 'live');

  console.log(JSON.stringify({
    ok: true,
    site: 'profitempire',
    baseline_parity_ready: true,
    builder_edit_invalidates_preview: true,
    config_mismatch_blocks_cutover: true,
    source_drift_marks_report_stale: true,
    restored_parity_ready: true,
    production_cutover_performed: false,
  }, null, 2));
} finally {
  await stopServer(server.child);
  await pool.end();
}
