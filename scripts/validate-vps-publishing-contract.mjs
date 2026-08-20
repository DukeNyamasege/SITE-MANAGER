import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildCaddySite,
  buildDeploymentManifest,
  prepareDeploymentFiles,
  PUBLISHING_CONTRACT_VERSION,
} from '../server/vps-publisher.js';

assert.equal(PUBLISHING_CONTRACT_VERSION, 2);

const manifest = buildDeploymentManifest({
  deploymentId: '11111111-1111-1111-1111-111111111111',
  websiteId: '22222222-2222-2222-2222-222222222222',
  siteKey: 'demo-site',
  hostname: 'demo.example.com',
  runtimeRelease: 'nnn-test-release',
  sharedRuntimeDir: '/srv/site-manager/nnn/current',
  apiUpstream: 'http://127.0.0.1:8787',
});

assert.equal(manifest.contract_version, 2);
assert.equal(manifest.runtime.name, 'nnn');
assert.equal(manifest.runtime.model, 'shared-static-runtime');
assert.equal(manifest.runtime.shared_dist_dir, '/srv/site-manager/nnn/current');
assert.equal(manifest.routes.runtime_api_prefix, '/api/v2/runtime');
assert.equal(manifest.routes.uploads_prefix, '/uploads');
assert.equal(manifest.healthcheck_url, 'https://demo.example.com/site-manager-runtime.json');

const caddy = buildCaddySite(manifest);
assert.match(caddy, /^demo\.example\.com \{/m);
assert.match(caddy, /handle \/api\/v2\/runtime\/\*/);
assert.match(caddy, /handle \/uploads\/\*/);
assert.match(caddy, /root \* "\/srv\/site-manager\/nnn\/current"/);
assert.match(caddy, /try_files \{path\} \/index\.html/);
assert.equal((caddy.match(/\/srv\/site-manager\/nnn\/current/g) || []).length, 1);
assert.ok(!caddy.includes('demo-site/dist'), 'Publishing must never create a per-customer nnn build path.');

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'site-manager-publish-'));
const liveRoutes = path.join(temp, 'live-caddy');
process.env.VPS_PUBLISH_MODE = 'plan';
process.env.VPS_DEPLOYMENT_STATE_DIR = path.join(temp, 'state');
process.env.CADDY_ROUTE_DIR = liveRoutes;
const prepared = await prepareDeploymentFiles(manifest);
assert.ok(prepared.routePath.startsWith(path.join(temp, 'state', 'planned-routes')));
const liveRouteFiles = await fs.readdir(liveRoutes).catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error));
assert.deepEqual(liveRouteFiles, [], 'Plan mode must not write any live Caddy route file.');
await fs.rm(temp, { recursive: true, force: true });

console.log('Shared nnn VPS publishing contract validation passed.');
