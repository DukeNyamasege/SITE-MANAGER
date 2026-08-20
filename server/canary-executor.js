import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const CANARY_CONTRACT_VERSION = 1;
const PUBLISHING_CONTRACT_VERSION = 2;
const CUTOVER_CONTRACT_VERSION = 1;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const cleanHost = value => String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');

export function canarySettings() {
  const requested = String(process.env.CANARY_EXECUTION_MODE || 'disabled').trim().toLowerCase();
  return {
    mode: requested === 'simulate' ? 'simulate' : 'disabled',
    stateDir: path.resolve(process.env.CANARY_SIMULATION_STATE_DIR || './data/canary-simulation'),
    runtimeDir: path.resolve(process.env.NNN_CANARY_DIST_DIR || process.env.NNN_SHARED_DIST_DIR || './data/nnn/current'),
    runtimeRelease: String(process.env.NNN_CANARY_RELEASE || process.env.NNN_RUNTIME_RELEASE || '').trim(),
    healthAttempts: Math.max(1, Math.min(5, Number(process.env.CANARY_HEALTH_ATTEMPTS || 3))),
    healthDelayMs: Math.max(0, Math.min(2000, Number(process.env.CANARY_HEALTH_DELAY_MS || 100))),
    minObservationSeconds: Math.max(0, Math.min(3600, Number(process.env.CANARY_MIN_OBSERVATION_SECONDS || 300))),
  };
}

function simulationRequired(settings) {
  if (settings.mode !== 'simulate') {
    const error = new Error('Canary execution is disabled. Step 13 supports simulation mode only.');
    error.status = 409;
    throw error;
  }
}

async function atomicWrite(filepath, value) {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  const temporary = `${filepath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, value, { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporary, filepath);
}

function routePath(settings, hostname) {
  const safe = cleanHost(hostname).replace(/[^a-z0-9.-]/g, '_');
  return path.join(settings.stateDir, 'active-routes', `${safe}.json`);
}

export async function validateCanaryRuntime(settings = canarySettings()) {
  simulationRequired(settings);
  const contractPath = path.join(settings.runtimeDir, 'site-manager-runtime.json');
  const raw = await fs.readFile(contractPath, 'utf8').catch(() => '');
  if (!raw) throw new Error(`Held nnn canary contract not found at ${contractPath}.`);
  const contract = JSON.parse(raw);
  const checks = {
    runtime_identity: contract.runtime === 'nnn',
    shared_runtime_model: contract.deployment_model === 'shared-static-runtime',
    publishing_contract: Number(contract.contract_version) === PUBLISHING_CONTRACT_VERSION,
    cutover_contract: Number(contract.cutover_contract_version) === CUTOVER_CONTRACT_VERSION,
    canary_contract: Number(contract.canary_contract_version) === CANARY_CONTRACT_VERSION,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
  if (failed.length) throw new Error(`Held nnn canary contract mismatch: ${failed.join(', ')}.`);
  return { contract, contractPath, checks };
}

export function canaryExecutionFingerprint({ executionId, plan, siteKey }) {
  return sha256(JSON.stringify({
    execution_id: executionId,
    plan_id: plan.id,
    plan_fingerprint: plan.plan_fingerprint,
    held_runtime_commit: plan.held_runtime_commit,
    primary_hostname: cleanHost(plan.primary_hostname),
    site_key: siteKey,
    canary_contract_version: CANARY_CONTRACT_VERSION,
    mode: 'simulate',
  }));
}

export async function runCanarySimulation({ executionId, plan, website, importItem, parity, forceFailure = false }) {
  const settings = canarySettings();
  simulationRequired(settings);
  const runtime = await validateCanaryRuntime(settings);
  const hostname = cleanHost(plan.primary_hostname);
  const routeFile = routePath(settings, hostname);
  const executionFingerprint = canaryExecutionFingerprint({ executionId, plan, siteKey: website.site_key });

  const routeSnapshot = {
    mode: 'simulate',
    execution_id: executionId,
    execution_fingerprint: executionFingerprint,
    hostname,
    target: {
      runtime: 'nnn',
      deployment_model: 'shared-static-runtime',
      held_runtime_commit: plan.held_runtime_commit,
      runtime_dir: settings.runtimeDir,
      runtime_release: settings.runtimeRelease,
    },
    expected_site: {
      site_key: website.site_key,
      legacy_site_id: importItem.legacy_site_id,
      v2_fingerprint: parity.v2_fingerprint,
    },
    production_traffic_changed: false,
    production_cutover_performed: false,
    activated_at: new Date().toISOString(),
  };
  await atomicWrite(routeFile, `${JSON.stringify(routeSnapshot, null, 2)}\n`);

  const baseChecks = {
    immutable_plan_current: parity.cutover_ready === true,
    site_identity_matches: website.site_key === importItem.legacy_site_id,
    primary_hostname_matches: cleanHost(website.primary_domain) === hostname,
    held_runtime_matches_plan: Boolean(settings.runtimeRelease && settings.runtimeRelease === plan.held_runtime_commit),
    publishing_contract_compatible: runtime.checks.publishing_contract,
    cutover_contract_compatible: runtime.checks.cutover_contract,
    canary_contract_compatible: runtime.checks.canary_contract,
    production_traffic_unchanged: true,
  };

  const attempts = [];
  let ok = false;
  for (let attempt = 1; attempt <= settings.healthAttempts; attempt += 1) {
    const checks = { ...baseChecks, forced_failure_absent: !forceFailure };
    const passed = Object.values(checks).every(Boolean);
    attempts.push({ attempt, passed, checks, checked_at: new Date().toISOString() });
    if (passed) { ok = true; break; }
    if (attempt < settings.healthAttempts && settings.healthDelayMs) await delay(settings.healthDelayMs);
  }

  const healthSnapshot = {
    ok,
    attempts,
    contract: runtime.contract,
    route_file: routeFile,
    production_traffic_changed: false,
    production_cutover_performed: false,
  };

  if (!ok) {
    const rollback = await rollbackCanarySimulation({
      executionId,
      hostname,
      rollbackSnapshot: plan.rollback_snapshot,
      reason: forceFailure ? 'Simulated post-activation health failure.' : 'Canary health criteria failed.',
      settings,
    });
    return { ok: false, routeSnapshot, healthSnapshot, rollback, executionFingerprint, settings };
  }

  return { ok: true, routeSnapshot, healthSnapshot, routeFile, executionFingerprint, settings };
}

export async function rollbackCanarySimulation({ executionId, hostname, rollbackSnapshot, reason, settings = canarySettings() }) {
  simulationRequired(settings);
  const routeFile = routePath(settings, hostname);
  await fs.rm(routeFile, { force: true });
  const rollbackRecord = {
    mode: 'simulate',
    execution_id: executionId,
    hostname: cleanHost(hostname),
    strategy: 'restore-legacy-nnn-production',
    rollback_snapshot: rollbackSnapshot || {},
    reason: String(reason || 'Canary rollback requested.'),
    restored_at: new Date().toISOString(),
    production_traffic_changed: false,
    production_cutover_performed: false,
  };
  const recordPath = path.join(settings.stateDir, 'rollback-records', `${executionId}.json`);
  await atomicWrite(recordPath, `${JSON.stringify(rollbackRecord, null, 2)}\n`);
  return { ...rollbackRecord, record_path: recordPath };
}

export async function completeCanarySimulation({ executionId, hostname, settings = canarySettings() }) {
  simulationRequired(settings);
  await fs.rm(routePath(settings, hostname), { force: true });
  const record = {
    mode: 'simulate',
    execution_id: executionId,
    hostname: cleanHost(hostname),
    passed_at: new Date().toISOString(),
    production_traffic_changed: false,
    production_cutover_performed: false,
  };
  const recordPath = path.join(settings.stateDir, 'passed-records', `${executionId}.json`);
  await atomicWrite(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, record_path: recordPath };
}
