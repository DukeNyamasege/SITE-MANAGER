# Step 15 — Production Eligibility + Final Approval

Step 15 is the last non-production gate before a future one-site production cutover executor exists.

## Safety boundary

Step 15 does **not** change DNS, Caddy customer routes, `website_deployments`, website live state, billing, or production traffic. The database hard-locks both `production_traffic_changed` and `production_cutover_performed` to `FALSE`, and the Step 15 `execute` endpoint always returns HTTP 409.

## Required evidence

A migrated site becomes production eligible only when all of the following still refer to the same site and the same held `nnn` release:

1. Step 11 dual-run parity is currently ready.
2. The legacy source commit/fingerprint has not drifted.
3. The Step 12 cutover plan is armed, unexpired, and still current.
4. The Step 13 canary passed for that exact plan and held `nnn` SHA.
5. The Step 14 real HTTPS staging-edge rehearsal passed for that exact canary and plan.
6. The staging pass is newer than `PRODUCTION_ELIGIBILITY_STAGING_MAX_AGE_MINUTES`.
7. The held `nnn` manifest advertises `production_eligibility_contract_version = 1`.
8. The current V2 fingerprint and primary hostname still match the armed plan.
9. Legacy rollback evidence is preserved.
10. All canary/staging/eligibility evidence still states that production traffic was unchanged.

## Record lifecycle

`eligible` → `approved` is the only positive path. `invalidated`, `expired`, and `revoked` are permanently non-actionable historical records.

The immutable evidence snapshot includes the upstream evidence IDs, source/held-runtime fingerprints and SHAs, primary hostname, checks, and rollback snapshot. If current evidence changes, a new eligibility record must be created.

Final approval stores the approving administrator and timestamp, but it still does not grant an execution capability in Step 15.

## Template alignment

The canonical held `nnn` integration advertises production eligibility contract version 1 in `/site-manager-runtime.json`. Production `nnn/main` remains isolated until the final migration is explicitly approved.

## Next milestone

Step 16 may design the first production-capable one-site executor. It must consume a current Step 15 `approved` record, revalidate it immediately before route movement, enforce a global one-site production lock, verify the shared `nnn` runtime through HTTPS after activation, and automatically restore the frozen legacy route on failure.
