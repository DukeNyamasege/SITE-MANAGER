# Step 12 — controlled cutover orchestration and rollback window

Step 12 inserts an explicit operator planning layer between Step 11 parity readiness and any future production traffic movement.

## What Step 12 can do

An administrator can prepare an immutable cutover plan only when the migrated website is currently `parity_ready`.

The plan pins:

- website ID and stable legacy site key,
- primary hostname,
- exact legacy source commit and source fingerprint,
- exact held `nnn` runtime commit,
- exact V2 fingerprint,
- the Step 11 parity report ID, checks and evidence timestamp,
- the held runtime publishing, migration and cutover contract evidence,
- the future health-check URL,
- Deriv Client/App ID, scopes, environment and callback URL,
- the configured VPS routing target,
- the exact legacy production source used as the rollback target,
- the operator-selected rollback-window duration.

Snapshot columns are protected by a PostgreSQL trigger. They cannot be edited in place. If evidence changes, the old plan is invalidated and a new plan must be created.

## Prepare versus arm versus execute

`prepared` means immutable evidence was captured.

`armed` means an administrator revalidated the plan and every required current check still passed. Arming checks:

- Step 11 is still parity-ready,
- legacy source commit/fingerprint are unchanged,
- held runtime commit is unchanged,
- V2 fingerprint is unchanged,
- held `nnn` exposes `cutover_contract_version = 1`,
- a VPS routing target is configured,
- the plan has not expired,
- V2 still reports production as legacy/not deployed.

`execute` does not exist as a traffic-moving capability in Step 12. The API deliberately returns HTTP 409 and records an `execution_blocked` audit event. `production_cutover_performed` remains database-constrained to `FALSE`.

## Automatic invalidation

Reading an open plan re-evaluates it against current Step 11 parity evidence.

A prepared or armed plan becomes invalidated when, for example:

- the customer changes colors/navigation/branding/Deriv configuration,
- preview approval is cleared,
- the live legacy source fingerprint drifts,
- the held `nnn` runtime SHA changes,
- the V2 fingerprint changes,
- the required cutover contract disappears,
- production no longer looks legacy.

Expired plans become `expired` rather than being reused.

## Rollback snapshot

Step 12 stores rollback intent before production movement exists:

- legacy source repository,
- exact legacy commit/fingerprint,
- legacy site ID,
- current live website URL,
- legacy callback URL,
- primary hostname and aliases,
- configured rollback-window minutes.

The rollback deadline remains `null` in Step 12 because the rollback clock should start only after a real production execution. DNS/provider rollback itself is deliberately deferred to the execution milestone.

## Template relationship

The held `nnn` integration exposes `cutover_contract_version = 1` in `site-manager-runtime.json`.

`nnn` remains passive. It does not approve cutovers, change DNS, arm plans or own rollback state. It supplies the exact shared runtime artifact and health contract that Site Manager will validate before and after a future cutover.

All Step 12 template changes stay on the canonical held integration branch. `nnn/main` remains the stable production source until an explicit final cutover decision.

## CI rehearsal

After Step 11 reaches parity-ready for the migrated Profit Empire fixture, CI:

1. proves a customer cannot access the admin cutover API,
2. prepares an immutable plan,
3. proves snapshot columns cannot be modified,
4. proves the execute endpoint is fail-closed,
5. arms the current plan,
6. changes the site through the real builder API,
7. proves the armed plan is invalidated,
8. restores and re-approves the site,
9. prepares a new plan,
10. simulates legacy source drift,
11. proves the new plan is invalidated,
12. verifies no production deployment was created and every cutover row still has `production_cutover_performed = false`.

The full Site Manager ↔ held `nnn` staging rehearsal still runs afterward on Node 22 and Node 24.
