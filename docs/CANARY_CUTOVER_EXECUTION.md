# Step 13 — Canary Cutover Execution and Automatic Rollback Drill

Step 13 proves the execution state machine without changing production traffic.

## Hard production boundary

`CANARY_EXECUTION_MODE` accepts only `disabled` or `simulate`. The Step 13 database schema stores only `mode = simulate` and constrains both `production_traffic_changed` and `production_cutover_performed` to `FALSE`.

The simulation adapter never calls the normal Caddy/VPS publisher. It writes isolated state under `CANARY_SIMULATION_STATE_DIR` and validates the exact held `nnn` build under `NNN_CANARY_DIST_DIR`.

Existing live `nnn/main` remains the production source for legacy subsites.

## Eligibility

A canary may start only when:

1. the website is an assigned migrated legacy `nnn` site,
2. Step 11 parity is still current,
3. a Step 12 immutable cutover plan is `armed`,
4. the plan still matches current source, V2 and held-runtime fingerprints,
5. the plan was created after the `canary_contract_version = 1` handshake,
6. the configured held `nnn` build SHA exactly matches the plan,
7. no other canary is activating or monitoring anywhere on the platform.

Each immutable cutover plan can be used for at most one canary execution. Retrying after rollback requires a fresh plan.

## Normal publish bypass protection

Migrated legacy sites are rejected by the ordinary customer deployment endpoint. Native/new V2 sites keep their normal deployment path, but migrated sites must use the admin-controlled migration/parity/cutover/canary sequence.

## Healthy canary

A healthy simulation writes isolated route state and checks:

- immutable plan is still current,
- site key equals the preserved legacy site ID,
- primary hostname matches the armed plan,
- configured held runtime release equals the exact held Git SHA,
- publishing contract v2,
- cutover contract v1,
- canary contract v1,
- production traffic remains unchanged.

Only after these checks pass does the execution enter `monitoring`. The rollback deadline is then calculated from the plan's frozen rollback-window duration.

## Automatic rollback drill

The rehearsal can force a post-activation health failure. The adapter then immediately removes the simulated route, writes a rollback record containing the frozen legacy rollback snapshot, marks the execution `rolled_back`, records `automatic_rollback = true`, and invalidates the used cutover plan.

The same legacy snapshot can be restored manually while a healthy canary is monitoring.

## Passed canary evidence

After the minimum observation interval, an administrator may mark a healthy simulation `passed`. The simulated route is removed and a passed record is stored. This is evidence for a later step; it does not create a production deployment or move traffic.

## CI rehearsal

Node 22 and Node 24 CI perform the sequence:

1. import the pinned stable legacy inventory,
2. assign the migrated test site,
3. build the exact canonical held `nnn` artifact,
4. produce fresh parity evidence,
5. rehearse Step 12 plan invalidation,
6. verify ordinary publish bypass is blocked,
7. create/arm a fresh plan,
8. run healthy canary and verify rollback timer,
9. prove the database rejects a second active canary,
10. manually roll back,
11. create/arm another plan,
12. force health failure and prove automatic rollback,
13. create/arm a third plan,
14. run healthy canary and mark it passed,
15. verify zero `website_deployments`, non-live website state and false production flags,
16. run the existing full Site Manager ↔ held `nnn` staging rehearsal afterward.

Step 14 is responsible for introducing a real staging-host adapter and reverse-proxy monitoring. Step 13 intentionally has no live/apply route.
