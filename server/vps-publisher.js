import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const PUBLISHING_CONTRACT_VERSION = 2;

export function publisherSettings() {
  const mode = String(process.env.VPS_PUBLISH_MODE || 'plan').trim().toLowerCase() === 'apply' ? 'apply' : 'plan';
  return {
    mode,
    stateDir: path.resolve(process.env.VPS_DEPLOYMENT_STATE_DIR || './data/deployments'),
    routeDir: path.resolve(process.env.CADDY_ROUTE_DIR || './data/caddy/sites'),
    sharedRuntimeDir: path.resolve(process.env.NNN_SHARED_DIST_DIR || './data/nnn/current'),
    runtimeRelease: String(process.env.NNN_RUNTIME_RELEASE || 'nnn-main-unpinned').trim(),
    apiUpstream: String(process.env.SITE_MANAGER_API_UPSTREAM || 'http://127.0.0.1:8787').trim(),
    caddyBin: String(process.env.CADDY_BIN || '/usr/bin/caddy').trim(),
    caddyfile: path.resolve(process.env.CADDYFILE || '/etc/caddy/Caddyfile'),
    healthAttempts: Math.max(1, Math.min(10, Number(process.env.VPS_HEALTHCHECK_ATTEMPTS || 4))),
    healthDelayMs: Math.max(250, Math.min(5000, Number(process.env.VPS_HEALTHCHECK_DELAY_MS || 1000))),
  };
}

function assertSafeHostname(hostname) {
  const value = String(hostname || '').trim().toLowerCase();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
    const error = new Error('Deployment hostname is invalid.');
    error.status = 400;
    throw error;
  }
  return value;
}

function caddyQuote(value) {
  return JSON.stringify(String(value));
}

export function buildDeploymentManifest({ deploymentId, websiteId, siteKey, hostname, runtimeRelease, sharedRuntimeDir, apiUpstream }) {
  const host = assertSafeHostname(hostname);
  return {
    contract_version: PUBLISHING_CONTRACT_VERSION,
    deployment_id: deploymentId,
    website_id: websiteId,
    site_key: siteKey,
    hostname: host,
    runtime: {
      name: 'nnn',
      release: runtimeRelease,
      model: 'shared-static-runtime',
      shared_dist_dir: sharedRuntimeDir,
    },
    routes: {
      runtime_api_prefix: '/api/v2/runtime',
      uploads_prefix: '/uploads',
      api_upstream: apiUpstream,
      spa_fallback: '/index.html',
    },
    healthcheck_url: `https://${host}/site-manager-runtime.json`,
    generated_at: new Date().toISOString(),
  };
}

export function buildCaddySite(manifest) {
  const host = assertSafeHostname(manifest.hostname);
  const runtimeDir = manifest.runtime?.shared_dist_dir;
  const upstream = manifest.routes?.api_upstream;
  if (!runtimeDir || !upstream) throw new Error('Deployment manifest is missing shared runtime routing values.');

  return `${host} {\n` +
    `  encode zstd gzip\n\n` +
    `  handle /api/v2/runtime/* {\n` +
    `    reverse_proxy ${upstream}\n` +
    `  }\n\n` +
    `  handle /uploads/* {\n` +
    `    reverse_proxy ${upstream}\n` +
    `  }\n\n` +
    `  handle {\n` +
    `    root * ${caddyQuote(runtimeDir)}\n` +
    `    try_files {path} /index.html\n` +
    `    file_server\n` +
    `  }\n` +
    `}\n`;
}

async function atomicWrite(filepath, contents) {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  const temporary = `${filepath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, contents, { encoding: 'utf8', mode: 0o640 });
  await fs.rename(temporary, filepath);
}

async function readOptional(filepath) {
  try { return await fs.readFile(filepath, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function managedRoutePath(filepath, settings) {
  const resolved = path.resolve(filepath);
  const root = `${settings.routeDir}${path.sep}`;
  if (!resolved.startsWith(root)) throw new Error('Refusing to modify a Caddy route outside Site Manager route storage.');
  return resolved;
}

export async function prepareDeploymentFiles(manifest) {
  const settings = publisherSettings();
  const manifestPath = path.join(settings.stateDir, 'manifests', `${manifest.deployment_id}.json`);
  const routePath = path.join(settings.routeDir, `${manifest.hostname}.caddy`);
  const previousRoute = await readOptional(routePath);
  await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await atomicWrite(routePath, buildCaddySite(manifest));
  return { manifestPath, routePath, previousRoute, settings };
}

async function restoreRoute(prepared) {
  if (prepared.previousRoute === null) {
    await fs.rm(prepared.routePath, { force: true });
  } else {
    await atomicWrite(prepared.routePath, prepared.previousRoute);
  }
}

async function retireRoutes(routePaths, prepared) {
  const retired = [];
  for (const value of [...new Set(routePaths || [])]) {
    if (!value) continue;
    const filepath = managedRoutePath(value, prepared.settings);
    if (filepath === path.resolve(prepared.routePath)) continue;
    const contents = await readOptional(filepath);
    if (contents === null) continue;
    retired.push({ filepath, contents });
    await fs.rm(filepath, { force: true });
  }
  return retired;
}

async function restoreRetiredRoutes(retired) {
  for (const item of retired) await atomicWrite(item.filepath, item.contents);
}

async function validateSharedRuntime(settings) {
  const contractPath = path.join(settings.sharedRuntimeDir, 'site-manager-runtime.json');
  const raw = await fs.readFile(contractPath, 'utf8').catch(() => '');
  if (!raw) throw new Error(`Shared nnn runtime contract not found at ${contractPath}. Build nnn before applying deployments.`);
  const contract = JSON.parse(raw);
  if (Number(contract.contract_version) !== PUBLISHING_CONTRACT_VERSION || contract.runtime !== 'nnn' || contract.deployment_model !== 'shared-static-runtime') {
    throw new Error(`Shared nnn runtime contract mismatch. Expected contract ${PUBLISHING_CONTRACT_VERSION}.`);
  }
  return contract;
}

async function reloadCaddy(settings) {
  await execFileAsync(settings.caddyBin, ['validate', '--config', settings.caddyfile, '--adapter', 'caddyfile'], { timeout: 15000 });
  await execFileAsync(settings.caddyBin, ['reload', '--config', settings.caddyfile, '--adapter', 'caddyfile'], { timeout: 15000 });
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function healthcheckDeployment(manifest, settings = publisherSettings()) {
  let lastMessage = '';
  for (let attempt = 1; attempt <= settings.healthAttempts; attempt += 1) {
    try {
      const response = await fetch(manifest.healthcheck_url, { redirect: 'follow', signal: AbortSignal.timeout(7000) });
      if (response.ok) {
        const payload = await response.json();
        if (payload.runtime === 'nnn' && Number(payload.contract_version) === PUBLISHING_CONTRACT_VERSION && payload.deployment_model === 'shared-static-runtime') {
          return { ok: true, status: response.status, contract: payload };
        }
        lastMessage = 'The hostname responded, but it was not the expected nnn publishing contract.';
      } else {
        lastMessage = `Health check returned HTTP ${response.status}.`;
      }
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error);
    }
    if (attempt < settings.healthAttempts) await delay(settings.healthDelayMs);
  }
  return { ok: false, message: lastMessage || 'Deployment health check failed.' };
}

export async function publishSharedRuntime(manifest, { retireRoutePaths = [] } = {}) {
  const prepared = await prepareDeploymentFiles(manifest);
  if (prepared.settings.mode !== 'apply') {
    return {
      applied: false,
      status: 'prepared',
      route_path: prepared.routePath,
      manifest_path: prepared.manifestPath,
      message: 'Deployment plan prepared. VPS apply mode is disabled.',
    };
  }

  let retired = [];
  try {
    if (!prepared.settings.runtimeRelease || prepared.settings.runtimeRelease === 'nnn-main-unpinned') {
      throw new Error('NNN_RUNTIME_RELEASE must identify the deployed nnn build before VPS apply mode can publish.');
    }
    await validateSharedRuntime(prepared.settings);
    retired = await retireRoutes(retireRoutePaths, prepared);
    await reloadCaddy(prepared.settings);
    const health = await healthcheckDeployment(manifest, prepared.settings);
    if (!health.ok) throw new Error(`Caddy reloaded but the nnn health check failed: ${health.message}`);

    return {
      applied: true,
      status: 'active',
      route_path: prepared.routePath,
      manifest_path: prepared.manifestPath,
      retired_routes: retired.map(item => item.filepath),
      health,
      message: 'The hostname is serving the shared nnn runtime over HTTPS.',
    };
  } catch (error) {
    await restoreRoute(prepared).catch(() => {});
    await restoreRetiredRoutes(retired).catch(() => {});
    await reloadCaddy(prepared.settings).catch(() => {});
    throw error;
  }
}
