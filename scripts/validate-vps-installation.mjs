import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const mustExist = relative => assert.ok(fs.existsSync(path.join(root, relative)), `${relative} must exist`);

const required = [
  'infra/vps/Caddyfile.template',
  'infra/vps/site-manager.service',
  'infra/vps/site-manager-backup.service',
  'infra/vps/site-manager-backup.timer',
  'infra/vps/install-prerequisites-ubuntu.sh',
  'infra/vps/install-host.sh',
  'infra/vps/provision-postgres.sh',
  'infra/vps/release-site-manager.sh',
  'infra/vps/release-nnn.sh',
  'infra/vps/rollback-site-manager.sh',
  'infra/vps/rollback-nnn.sh',
  'infra/vps/backup-state.sh',
  'infra/vps/README.md',
];
required.forEach(mustExist);

const service = read('infra/vps/site-manager.service');
assert.match(service, /User=site-manager/);
assert.match(service, /EnvironmentFile=\/etc\/site-manager\/database\.env/);
assert.match(service, /EnvironmentFile=-\/etc\/site-manager\/runtime\.env/);
assert.match(service, /WorkingDirectory=\/srv\/site-manager\/manager\/current/);
assert.match(service, /ReadWritePaths=\/srv\/site-manager\/data \/etc\/caddy\/sites/);
assert.ok(!/User=root/.test(service), 'Site Manager service must not run as root.');

const caddy = read('infra/vps/Caddyfile.template');
assert.match(caddy, /__SITE_MANAGER_DOMAIN__/);
assert.match(caddy, /__NNN_PREVIEW_DOMAIN__/);
assert.match(caddy, /root \* "\/srv\/site-manager\/nnn\/current"/);
assert.match(caddy, /handle \/api\/v2\/runtime\/\*/);
assert.match(caddy, /import \/etc\/caddy\/sites\/\*\.caddy/);

const host = read('infra/vps/install-host.sh');
assert.match(host, /VPS_PUBLISH_MODE=plan/);
assert.match(host, /NNN_SHARED_DIST_DIR=\/srv\/site-manager\/nnn\/current/);
assert.match(host, /install -d -m 2770 -o root -g site-manager-runtime \/etc\/caddy\/sites/);
assert.ok(!host.includes('VPS_PUBLISH_MODE=apply'), 'Host bootstrap must not enable customer publishing apply mode.');

const nnn = read('infra/vps/release-nnn.sh');
assert.match(nnn, /NNN_CUTOVER_APPROVED/);
assert.match(nnn, /contract_version\) !== 2|contract_version\)!==2/);
assert.match(nnn, /shared-static-runtime/);
assert.match(nnn, /\/srv\/site-manager\/nnn/);
assert.ok(!nnn.includes('git checkout main'), 'nnn release must never silently choose main.');
assert.ok(!nnn.includes('NNN_CUTOVER_APPROVED=YES\n'), 'Release script must not self-enable cutover approval.');

const managerRelease = read('infra/vps/release-site-manager.sh');
assert.match(managerRelease, /npm run build/);
assert.match(managerRelease, /scripts\/migrate\.mjs/);
assert.match(managerRelease, /api\/v2\/health/);
assert.match(managerRelease, /mv -Tf/);

const backup = read('infra/vps/backup-state.sh');
assert.match(backup, /pg_dump --format=custom/);
assert.match(backup, /uploads\.tar\.gz/);
assert.match(backup, /deployments\.tar\.gz/);

console.log('VPS installation/service/release contract validation passed.');
