import assert from 'node:assert/strict';
import fs from 'node:fs';

const executor = fs.readFileSync('server/staging-edge-executor.js', 'utf8');
const monitor = fs.readFileSync('server/staging-edge-monitor.js', 'utf8');
const runtime = fs.readFileSync('server/runtime.js', 'utf8');
const migration = fs.readFileSync('server/migrations/011_staging_edge_monitor.sql', 'utf8');
const installer = fs.readFileSync('infra/vps/install-staging-edge.sh', 'utf8');
const release = fs.readFileSync('infra/vps/release-nnn.sh', 'utf8');
const service = fs.readFileSync('infra/vps/site-manager-staging-caddy.service', 'utf8');

for (const marker of [
  "environment === 'staging'",
  "approved && requestedMode === 'staging'",
  'STAGING_EDGE_CONTRACT_VERSION = 1',
  "production_traffic_changed: false",
  'caddy validate',
]) {
  if (marker === 'caddy validate') assert.ok(executor.includes("['validate', '--config'"), 'staging adapter must validate Caddy before reload');
  else assert.ok(executor.includes(marker), `staging executor missing safety marker: ${marker}`);
}
assert.ok(!executor.includes('/etc/caddy/sites'), 'staging adapter must never write the production customer-route directory');
assert.ok(executor.includes('X-Site-Manager-Staging-Run'));
assert.ok(executor.includes('X-Site-Manager-Staging-Token'));
assert.ok(executor.includes('/site-manager-runtime.json'));
assert.ok(executor.includes('/api/v2/runtime/site'));

assert.ok(monitor.includes("status IN ('applying', 'monitoring')"));
assert.ok(monitor.includes('monitor_recovered'));
assert.ok(monitor.includes('automaticRollback'));
assert.ok(runtime.includes("shapeRuntime(row, 'staging'"));
assert.ok(runtime.includes("request.headers['x-site-manager-staging-token']"));

assert.match(migration, /CHECK \(production_traffic_changed = FALSE\)/);
assert.match(migration, /CHECK \(production_cutover_performed = FALSE\)/);
assert.match(migration, /website_staging_edge_one_active_globally/);

assert.ok(installer.includes('SITE_MANAGER_ENVIRONMENT must equal staging'));
assert.ok(installer.includes('STAGING_EDGE_APPROVED must equal YES'));
assert.ok(installer.includes('site-manager-staging-caddy.service'));
assert.ok(installer.includes('site-manager-runtime'));
assert.ok(service.includes('SupplementaryGroups=site-manager site-manager-runtime'));
assert.ok(service.includes('/etc/site-manager/staging/Caddyfile'));
assert.ok(service.includes('127.0.0.1:2020'));

assert.ok(release.includes('NNN_STAGING_APPROVED'));
assert.ok(release.includes('NNN_CUTOVER_APPROVED'));
assert.ok(release.includes('NNN_STAGING_RELEASE'));
assert.ok(release.includes('staging_edge_contract_version'));

console.log('Step 14 staging-edge safety contract validation passed.');
