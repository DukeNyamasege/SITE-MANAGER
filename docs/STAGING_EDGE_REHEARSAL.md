# Step 14: Real staging-host execution adapter and cutover monitor

Step 14 converts the Step 13 simulation state machine into a real reverse-proxy rehearsal on an isolated staging hostname. It does not add a production traffic adapter.

## Safety boundary

The staging edge enables only when all three settings are present:

- `SITE_MANAGER_ENVIRONMENT=staging`
- `STAGING_EDGE_APPROVED=YES`
- `STAGING_EDGE_MODE=staging`

The staging hostname must differ from the customer production hostname. PostgreSQL hard-locks `production_traffic_changed` and `production_cutover_performed` to false. Staging Caddy uses `/etc/site-manager/staging/Caddyfile` and its own admin endpoint rather than `/etc/caddy/sites`, which is reserved for the later production publisher.

## Required evidence

A real staging run starts only from a Step 13 canary whose status is `passed`. Its associated Step 12 plan must still be `armed`, unexpired and current. The plan pins the exact held `nnn` SHA and must carry publishing contract v2 plus migration, cutover, canary and staging-edge contract v1 evidence.

## Runtime channel

Caddy serves the exact held `nnn` build. Requests under `/api/v2/runtime/*` are proxied to Site Manager with a short-lived staging run ID and secret. Site Manager stores only the token hash in PostgreSQL. The runtime response uses `mode: staging` and includes the run ID. `nnn` treats staging as the same non-trading safety posture as private preview, so OAuth session restoration and trading bridges do not run while the real UI is being inspected.

## HTTPS health criteria

The monitor reaches the staging hostname through HTTPS and verifies:

1. `/site-manager-runtime.json` is reachable and reports `runtime=nnn`, shared-static-runtime, publishing v2 and staging-edge v1.
2. `/api/v2/runtime/site` returns `mode=staging` for the expected migrated `site_key` and staging run ID.
3. `/` serves the actual shared `nnn` SPA.
4. The installed `NNN_STAGING_RELEASE` equals the immutable plan's held runtime SHA.

The rollback deadline starts only after the initial HTTPS health check passes.

## Restart recovery

Active run state lives in PostgreSQL. When Site Manager restarts:

- an incomplete `applying` run is rolled back instead of being assumed healthy;
- a `monitoring` run is marked recovered, immediately rechecked and resumes monitoring from its existing rollback deadline.

Repeated health failures trigger automatic staging rollback. A healthy run may pass after its observation/rollback window, at which point the temporary staging route is retired.

## Staging VPS installation

Use the normal Step 8 host package first. Then, only on an isolated staging VPS, install the held `nnn` release with `SITE_MANAGER_ENVIRONMENT=staging NNN_STAGING_APPROVED=YES`, and install the staging edge with `SITE_MANAGER_ENVIRONMENT=staging STAGING_EDGE_APPROVED=YES STAGING_EDGE_HOSTNAME=<staging-host> bash infra/vps/install-staging-edge.sh`.

The staging installer does not enable `VPS_PUBLISH_MODE=apply`, does not create customer Caddy routes and does not alter billing.

## CI proof

GitHub Actions runs Caddy itself with an internal TLS certificate on an isolated port. It serves the real held `nnn` build, proxies the real Site Manager runtime endpoint, verifies HTTPS/site identity, restarts the Site Manager process and proves monitor recovery, completes a healthy window, then deliberately makes the staging Caddy edge unhealthy and proves automatic rollback. It finally checks that the migrated website is still not live and that no production `website_deployments` row was created.
