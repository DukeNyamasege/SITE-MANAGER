# Step 11 — dual-run parity and per-site cutover readiness

Step 11 proves whether a migrated Site Manager V2 shadow is equivalent to the still-live legacy `nnn` site. It does **not** perform production cutover.

## Safety boundary

A parity-ready report cannot:

- change DNS,
- mark a VPS route ready,
- provision SSL,
- create or activate a deployment,
- change production `nnn/main`,
- start billing,
- set `production_cutover_performed = true`.

The Step 11 database migration constrains `production_cutover_performed` to `FALSE`. A future cutover milestone must deliberately introduce a new migration before that state can change.

## Evidence model

Step 11 combines two evidence planes.

### 1. PostgreSQL live/V2 evidence

The customer-facing parity endpoint recomputes these checks from current database state every time it is read:

- migration assignment is linked to the website,
- legacy site ID equals V2 `site_key`,
- assigned source fingerprint still equals the latest audited live source fingerprint,
- primary domain matches,
- all legacy hostname aliases match,
- migrated domain ownership is verified,
- Deriv Client/App ID matches,
- Deriv scopes match,
- Deriv environment matches,
- callback URL matches the legacy registry,
- navigation ordering/features match,
- colors match,
- legacy domain-derived branding identity is preserved,
- configuration is complete,
- the current preview is approved,
- V2 is still not live/deployed.

Because these checks are recomputed, editing V2 immediately blocks parity if the new value differs from the legacy site.

### 2. Stable-live versus held-runtime filesystem evidence

`scripts/check-legacy-parity.mjs` compares two exact Git checkouts:

- the stable live source checkout,
- the held Site Manager integration checkout.

For every assigned migrated site it checks:

- exact registry entry parity,
- explicit per-site customization file parity, or inherited catalog-default parity,
- site-specific free-bot manifest parity,
- every bot asset referenced by that manifest,
- required `nnn` publishing contract version 2,
- required migration contract version 1.

The resulting evidence is stored with both the legacy source fingerprint and held runtime commit. If the legacy source changes later, the stored runtime evidence becomes stale automatically until the audit is rerun.

## Preview approval invalidation

A database trigger now clears `websites.preview_approved_at` whenever `website_configs` changes. This covers builder changes and VPS logo replacement.

Therefore this sequence is impossible:

1. approve preview,
2. change site configuration,
3. remain cutover-ready using the old approval.

The changed site must be completed and reviewed again.

## Statuses

- `parity_ready`: every required database and held-runtime check passes.
- `blocked`: one or more current checks fail, or no held-runtime evidence exists yet.
- `stale`: a parity report exists but its source commit/fingerprint no longer matches the latest audited legacy source.

`parity_ready` is preparation evidence only. It is not permission to cut over production automatically.

## CI rehearsal

CI continues the Step 10 flow, then:

1. assigns `profitempire` to the verified test customer,
2. builds the canonical held `nnn` branch,
3. approves the current preview through the real API,
4. generates dual-run filesystem/runtime evidence,
5. proves Profit Empire reaches `parity_ready`,
6. edits theme configuration through the real builder API,
7. proves the previous preview approval is cleared,
8. proves the configuration mismatch blocks readiness,
9. restores configuration and re-approves preview,
10. proves readiness returns,
11. simulates a changed live source fingerprint,
12. proves runtime evidence becomes `stale`,
13. restores the source fingerprint and proves readiness returns,
14. verifies the website remains `not_deployed` and not `live`.

This rehearsal runs on Node 22 and Node 24 and is followed by the existing full Site Manager ↔ held `nnn` staging rehearsal.
