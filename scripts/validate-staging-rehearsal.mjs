import assert from 'node:assert/strict';
import fs from 'node:fs';

const rehearsal = fs.readFileSync('scripts/rehearse-staging.mjs', 'utf8');
assert.match(rehearsal, /NODE_ENV: 'test'/);
assert.match(rehearsal, /VPS_PUBLISH_MODE: 'plan'/);
assert.match(rehearsal, /billing_required, false/);
assert.match(rehearsal, /deployment\.status, 'prepared'/);
assert.match(rehearsal, /runtime\/site\?host=/);
assert.match(rehearsal, /rehearsal_contract_version\), 1/);
assert.match(rehearsal, /DELETE FROM users WHERE id = \$1/);
assert.ok(!rehearsal.includes('NNN_CUTOVER_APPROVED=YES'), 'CI rehearsal must never approve production nnn cutover.');
assert.ok(!rehearsal.includes('VPS_PUBLISH_MODE: \'apply\''), 'CI rehearsal server must remain in plan mode.');

const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
assert.match(workflow, /hold\/site-manager-v2-integration-2026-08-20|feat\/staging-rehearsal-contract/);
assert.match(workflow, /scripts\/rehearse-staging\.mjs/);
assert.ok(!/checkout.*nnn.*ref:\s*main/i.test(workflow), 'Staging CI must not build nnn/main integration work.');

console.log('Staging rehearsal safety contract validation passed.');
