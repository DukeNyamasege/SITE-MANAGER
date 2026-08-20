# Step 10 — existing nnn sites into V2 ownership

Step 10 imports the sites already served by production `DukeNyamasege/nnn` into the Site Manager V2 data model without changing production traffic.

## Production boundary

- Production `nnn/main` remains on the stable pre-integration commit during development.
- Site Manager/VPS runtime work remains behind the held nnn integration PR.
- Importing or assigning a legacy site never creates an active VPS deployment.
- Billing/payment is not part of migration.

## Source audit

The importer reads an exact Git checkout of the legacy nnn source. CI pins the production source to commit `148d3fc2d265a2ce724d1503369068fae44cce21`.

It audits:

- `brand.config.json -> sites.entries`,
- `public/site-config/catalog.json` defaults,
- optional `public/site-config/domains/<site-id>.json` overrides,
- optional `public/free-bots/domains/<site-id>.json` manifest references.

The current pinned inventory has 13 registry sites, 4 explicit customization files and 4 site-specific free-bot manifests. Sites without an explicit customization file are recorded as inheriting the nnn defaults; the importer does not fabricate a custom override.

Every inventory item records a SHA-256 source fingerprint. The importer is idempotent and may be rerun safely.

## Holding inventory first

`legacy_nnn_site_imports` is deliberately separate from customer-owned `websites`.

A freshly audited record is `unassigned`. A domain name alone cannot create ownership. The public website APIs never accept `owner_user_id` for migration.

Only an authenticated Site Manager administrator can assign a legacy record, and the target owner must already have an active verified Site Manager account.

Administrators are promoted explicitly on the VPS:

```bash
npm run admin:promote -- owner@example.com
```

## Assignment

Admin assignment preserves:

- the exact legacy site ID as `websites.site_key`,
- primary hostname and hostname aliases,
- Deriv Client/App ID, scopes and environment,
- explicit navigation/color overrides or inherited nnn defaults,
- legacy free-bot manifest reference metadata,
- exact source commit/fingerprint.

The V2 record is created with:

- `source = migrated`,
- `status = ready`,
- `deployment_status = not_deployed`,
- `configuration_status = complete`,
- no preview approval,
- no active deployment.

Existing hostnames are recorded as administratively verified legacy domains, but VPS routing and SSL remain `pending`. This prevents assignment from pretending the host is already routed to the new VPS.

## Drift detection

When an assigned legacy site's production source changes later, rerunning the audit updates the source snapshot but does not overwrite its V2 website configuration. Instead `drift_status` becomes `drifted`.

This is the dual-run safety signal used by the next milestone before any site is eligible for cutover.

## nnn runtime contract

The held nnn runtime understands optional migration metadata:

- source `legacy-nnn`,
- preserved `legacy_site_id`,
- source commit/fingerprint,
- drift status,
- production-cutover flag.

The runtime rejects migrated configuration if `legacy_site_id` does not match the runtime site ID. The built nnn artifact declares migration contract version 1 alongside publishing contract version 2 and rehearsal contract version 1.

## CI rehearsal

CI performs the following on Node 22 and 24:

1. checks out the pinned stable nnn production source,
2. dry-runs the audit,
3. imports the inventory,
4. imports it a second time to prove idempotence,
5. verifies customer accounts cannot access the admin inventory,
6. assigns `profitempire` to a verified test customer through the real admin API,
7. repeats the assignment to prove same-owner idempotence,
8. verifies the preserved site key, customization and Deriv Client ID,
9. verifies the shadow remains `ready` and `not_deployed`,
10. builds the held nnn migration contract and runs the existing staging rehearsal.

Step 10 therefore migrates control-plane representation only. Existing production customer traffic remains on stable `nnn/main` until an explicit future cutover.
