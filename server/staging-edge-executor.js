import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

export const STAGING_EDGE_CONTRACT_VERSION = 1;
const PUBLISHING_CONTRACT_VERSION = 2;
const CUTOVER_CONTRACT_VERSION = 1;
const CANARY_CONTRACT_VERSION = 1;
const execFile = promisify(execFileCallback);

const cleanHost = value => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/^https?:\/\//, '')
  .replace(/\/.*$/, '')
  .replace(/:\d+$/, '');

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

export function stagingEdgeSettings() {
  const environment = String(process.env.SITE_MANAGER_ENVIRONMENT || 'development').trim().toLowerCase();
  const approved = String(process.env.STAGING_EDGE_APPROVED || '').trim() === 'YES';
  const requestedMode = String(process.env.STAGING_EDGE_MODE || 'disabled').trim().toLowerCase();
  const hostname = cleanHost(process.env.STAGING_EDGE_HOSTNAME || '');
  const httpsPort = clamp(process.env.STAGING_EDGE_HTTPS_PORT, 1, 65535, 443);
  const tlsMode = String(process.env.STAGING_EDGE_TLS_MODE || 'public').trim().toLowerCase() === 'internal' ? 'internal' : 'public';
  return {
    environment,
    approved,
    mode: environment === 'staging' && approved && requestedMode === 'staging' ? 'staging' : 'disabled',
    hostname,
    httpsPort,
    tlsMode,
    caddyBin: String(process.env.STAGING_CADDY_BIN || process.env.CADDY_BIN || '/usr/bin/caddy').trim(),
    caddyfile: path.resolve(process.env.STAGING_EDGE_CADDYFILE || './data/staging-edge/Caddyfile'),
    caddyAdmin: String(process.env.STAGING_EDGE_CADDY_ADMIN || '127.0.0.1:2020').trim(),
    stateDir: path.resolve(process.env.STAGING_EDGE_STATE_DIR || './data/staging-edge'),
    runtimeDir: path.resolve(process.env.NNN_STAGING_DIST_DIR || process.env.NNN_SHARED_DIST_DIR || './data/nnn/current'),
    runtimeRelease: String(process.env.NNN_STAGING_RELEASE || process.env.NNN_RUNTIME_RELEASE || '').trim(),
    apiUpstream: String(process.env.STAGING_SITE_MANAGER_API_UPSTREAM || process.env.SITE_MANAGER_API_UPSTREAM || 'http://127.0.0.1:8787').trim(),
    curlBin: String(process.env.STAGING_EDGE_CURL_BIN || '/usr/bin/curl').trim(),
    resolveIp: String(process.env.STAGING_EDGE_RESOLVE_IP || '').trim(),
    requestTimeoutSeconds: clamp(process.env.STAGING_EDGE_REQUEST_TIMEOUT_SECONDS, 1, 30, 5),
    monitorIntervalMs: clamp(process.env.STAGING_EDGE_MONITOR_INTERVAL_MS, 250, 60_000, 5_000),
    failureThreshold: clamp(process.env.STAGING_EDGE_FAILURE_THRESHOLD, 1, 10, 3),
    minObservationSeconds: clamp(process.env.STAGING_EDGE_MIN_OBSERVATION_SECONDS, 0, 86_400, 300),
    tokenTtlMinutes: clamp(process.env.STAGING_EDGE_TOKEN_TTL_MINUTES, 5, 1_440, 120),
    failureDrillAllowed: String(process.env.STAGING_EDGE_DRILL_ALLOW_FAILURE || '').trim() === 'YES',
  };
}

export function requireStagingEdge(settings = stagingEdgeSettings()) {
  if (settings.mode !== 'staging') {
    const error = new Error('Real staging-edge execution is disabled. It requires SITE_MANAGER_ENVIRONMENT=staging, STAGING_EDGE_APPROVED=YES and STAGING_EDGE_MODE=staging.');
    error.status = 409;
    throw error;
  }
  if (!settings.hostname) {
    const error = new Error('STAGING_EDGE_HOSTNAME must be configured before a staging-edge rehearsal can run.');
    error.status = 409;
    throw error;
  }
  return settings;
}

async function atomicWrite(filepath, content) {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  const temporary = `${filepath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporary, filepath);
}

function siteAddress(settings) {
  return settings.httpsPort === 443
    ? settings.hostname
    : `https://${settings.hostname}:${settings.httpsPort}`;
}

function baseUrl(settings) {
  return settings.httpsPort === 443
    ? `https://${settings.hostname}`
    : `https://${settings.hostname}:${settings.httpsPort}`;
}

function globalBlock(settings) {
  return `{
  admin ${settings.caddyAdmin}
}\n\n`;
}

function tlsDirective(settings) {
  return settings.tlsMode === 'internal' ? '  tls internal\n' : '';
}

function activeCaddyfile({ settings, runId, runtimeToken }) {
  return `${globalBlock(settings)}${siteAddress(settings)} {
  encode zstd gzip
${tlsDirective(settings)}
  handle /api/v2/runtime/* {
    reverse_proxy ${settings.apiUpstream} {
      header_up X-Site-Manager-Staging-Run "${runId}"
      header_up X-Site-Manager-Staging-Token "${runtimeToken}"
    }
  }

  handle /uploads/* {
    reverse_proxy ${settings.apiUpstream}
  }

  handle {
    root * "${settings.runtimeDir}"
    try_files {path} /index.html
    file_server
  }
}
`;
}

function idleCaddyfile(settings) {
  return `${globalBlock(settings)}${siteAddress(settings)} {
${tlsDirective(settings)}  respond "Site Manager staging edge is idle" 503
}
`;
}

function failureDrillCaddyfile(settings) {
  return `${globalBlock(settings)}${siteAddress(settings)} {
${tlsDirective(settings)}  respond "Step 14 staging health drill" 503
}
`;
}

async function runCaddy(settings, args, timeout = 15_000) {
  return execFile(settings.caddyBin, args, { encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 });
}

async function validateAndReload(settings) {
  await runCaddy(settings, ['validate', '--config', settings.caddyfile, '--adapter', 'caddyfile']);
  await runCaddy(settings, ['reload', '--config', settings.caddyfile, '--adapter', 'caddyfile', '--address', settings.caddyAdmin]);
}

export async function validateStagingRuntime(settings = stagingEdgeSettings()) {
  requireStagingEdge(settings);
  const contractPath = path.join(settings.runtimeDir, 'site-manager-runtime.json');
  const raw = await fs.readFile(contractPath, 'utf8').catch(() => '');
  if (!raw) throw new Error(`Held nnn staging contract not found at ${contractPath}.`);
  const contract = JSON.parse(raw);
  const checks = {
    runtime_identity: contract.runtime === 'nnn',
    shared_runtime_model: contract.deployment_model === 'shared-static-runtime',
    publishing_contract: Number(contract.contract_version) === PUBLISHING_CONTRACT_VERSION,
    cutover_contract: Number(contract.cutover_contract_version) === CUTOVER_CONTRACT_VERSION,
    canary_contract: Number(contract.canary_contract_version) === CANARY_CONTRACT_VERSION,
    staging_edge_contract: Number(contract.staging_edge_contract_version) === STAGING_EDGE_CONTRACT_VERSION,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
  if (failed.length) throw new Error(`Held nnn staging-edge contract mismatch: ${failed.join(', ')}.`);
  return { contract, contractPath, checks };
}

export async function initializeStagingEdgeIdle(settings = stagingEdgeSettings()) {
  requireStagingEdge(settings);
  await atomicWrite(settings.caddyfile, idleCaddyfile(settings));
  return settings.caddyfile;
}

export async function applyStagingEdge({ runId, runtimeToken, expectedHeldCommit, customerHostname = '' }) {
  const settings = requireStagingEdge(stagingEdgeSettings());
  const runtime = await validateStagingRuntime(settings);
  if (!runtimeToken) throw new Error('A short-lived staging runtime token is required.');
  if (!settings.runtimeRelease || settings.runtimeRelease !== expectedHeldCommit) {
    throw new Error(`Installed staging nnn release does not match the immutable plan. Expected ${expectedHeldCommit}, got ${settings.runtimeRelease || 'unset'}.`);
  }
  if (cleanHost(customerHostname) && cleanHost(customerHostname) === settings.hostname) {
    throw new Error('The staging-edge hostname must not be the customer production hostname.');
  }

  await atomicWrite(settings.caddyfile, activeCaddyfile({ settings, runId, runtimeToken }));
  try {
    await validateAndReload(settings);
  } catch (error) {
    await atomicWrite(settings.caddyfile, idleCaddyfile(settings));
    await validateAndReload(settings).catch(() => {});
    throw error;
  }

  const routeSnapshot = {
    mode: 'staging',
    staging_hostname: settings.hostname,
    https_port: settings.httpsPort,
    tls_mode: settings.tlsMode,
    caddy_admin: settings.caddyAdmin,
    caddyfile: settings.caddyfile,
    runtime: 'nnn',
    held_runtime_commit: expectedHeldCommit,
    runtime_dir: settings.runtimeDir,
    api_upstream: settings.apiUpstream,
    staging_traffic_changed: true,
    production_traffic_changed: false,
    production_cutover_performed: false,
    applied_at: new Date().toISOString(),
  };
  return {
    settings,
    routeSnapshot,
    healthUrl: `${baseUrl(settings)}/site-manager-runtime.json`,
    runtimeContract: runtime,
  };
}

function curlArgs(settings, url) {
  const args = ['--fail', '--silent', '--show-error', '--max-time', String(settings.requestTimeoutSeconds)];
  if (settings.tlsMode === 'internal') args.push('--insecure');
  if (settings.resolveIp) args.push('--resolve', `${settings.hostname}:${settings.httpsPort}:${settings.resolveIp}`);
  args.push(url);
  return args;
}

async function curlText(settings, pathname) {
  const url = `${baseUrl(settings)}${pathname}`;
  const { stdout } = await execFile(settings.curlBin, curlArgs(settings, url), {
    encoding: 'utf8',
    timeout: (settings.requestTimeoutSeconds + 2) * 1000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return { url, text: String(stdout || '') };
}

export async function checkStagingEdgeHealth({ runId, expectedSiteKey, expectedHeldCommit }) {
  const settings = requireStagingEdge(stagingEdgeSettings());
  const manifestResponse = await curlText(settings, '/site-manager-runtime.json');
  const runtimeResponse = await curlText(settings, `/api/v2/runtime/site?host=${encodeURIComponent(settings.hostname)}`);
  const rootResponse = await curlText(settings, '/');
  const manifest = JSON.parse(manifestResponse.text || '{}');
  const runtime = JSON.parse(runtimeResponse.text || '{}');
  const root = rootResponse.text.toLowerCase();

  const checks = {
    https_manifest_reachable: Boolean(manifestResponse.text),
    runtime_identity: manifest.runtime === 'nnn',
    shared_runtime_model: manifest.deployment_model === 'shared-static-runtime',
    publishing_contract: Number(manifest.contract_version) === PUBLISHING_CONTRACT_VERSION,
    cutover_contract: Number(manifest.cutover_contract_version) === CUTOVER_CONTRACT_VERSION,
    canary_contract: Number(manifest.canary_contract_version) === CANARY_CONTRACT_VERSION,
    staging_edge_contract: Number(manifest.staging_edge_contract_version) === STAGING_EDGE_CONTRACT_VERSION,
    held_runtime_matches: Boolean(settings.runtimeRelease && settings.runtimeRelease === expectedHeldCommit),
    runtime_mode_staging: runtime.mode === 'staging',
    site_identity_matches: runtime.site?.id === expectedSiteKey,
    migrated_identity_matches: !runtime.migration || runtime.migration.legacy_site_id === expectedSiteKey,
    staging_run_matches: runtime.staging?.run_id === runId,
    spa_reachable: root.includes('<!doctype') || root.includes('<html') || root.includes('id="root"'),
    production_traffic_unchanged: true,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
  return {
    ok: failed.length === 0,
    checks,
    failed,
    checked_at: new Date().toISOString(),
    urls: {
      manifest: manifestResponse.url,
      runtime: runtimeResponse.url,
      root: rootResponse.url,
    },
    manifest: {
      contract_version: manifest.contract_version,
      canary_contract_version: manifest.canary_contract_version,
      staging_edge_contract_version: manifest.staging_edge_contract_version,
      runtime: manifest.runtime,
      deployment_model: manifest.deployment_model,
    },
    runtime: {
      mode: runtime.mode,
      site_id: runtime.site?.id,
      legacy_site_id: runtime.migration?.legacy_site_id || null,
      staging_run_id: runtime.staging?.run_id || null,
    },
    production_traffic_changed: false,
    production_cutover_performed: false,
  };
}

export async function deactivateStagingEdge({ reason = 'Staging edge deactivated.' } = {}) {
  const settings = requireStagingEdge(stagingEdgeSettings());
  await atomicWrite(settings.caddyfile, idleCaddyfile(settings));
  await validateAndReload(settings);
  const record = {
    mode: 'staging',
    staging_hostname: settings.hostname,
    reason: String(reason),
    staging_traffic_changed: false,
    production_traffic_changed: false,
    production_cutover_performed: false,
    restored_at: new Date().toISOString(),
  };
  const recordPath = path.join(settings.stateDir, 'rollback-records', `${Date.now()}.json`);
  await atomicWrite(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, record_path: recordPath };
}

export async function breakStagingEdgeForDrill() {
  const settings = requireStagingEdge(stagingEdgeSettings());
  if (!settings.failureDrillAllowed) {
    const error = new Error('Staging failure drill is disabled. Set STAGING_EDGE_DRILL_ALLOW_FAILURE=YES only on an isolated staging host.');
    error.status = 409;
    throw error;
  }
  await atomicWrite(settings.caddyfile, failureDrillCaddyfile(settings));
  await validateAndReload(settings);
  return { staging_hostname: settings.hostname, drill_applied_at: new Date().toISOString() };
}
