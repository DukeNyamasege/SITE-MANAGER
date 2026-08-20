# Step 8 — VPS installation architecture

Step 8 packages the code from Steps 1–7 into a repeatable host layout without touching a production VPS.

## What runs

### Site Manager

One Node.js process runs `server/index.js` under systemd as the non-login `site-manager` user. The same service serves the built V2 manager frontend and all authenticated/public runtime APIs.

### PostgreSQL

One PostgreSQL database stores users, sessions, websites, builder configuration, preview sessions, domains and versioned deployments. Payment remains dormant and is not an activation requirement.

### `nnn`

One static production build is installed at `/srv/site-manager/nnn/current`. Every customer hostname and the private preview hostname serve that same build. Customer differences come from Site Manager runtime JSON/PostgreSQL, not separate builds.

### Caddy

Caddy owns public ports 80/443, automatic HTTPS and three route classes:

1. Site Manager hostname -> `127.0.0.1:8787`.
2. Preview hostname -> shared `nnn`, with runtime/uploads proxied to Site Manager.
3. Customer hostnames -> generated Step 7 route snippets, also serving the same shared `nnn` release.

## Release model

Both applications use immutable releases and atomic `current` symlinks. Site Manager can be upgraded independently. `nnn` activation is guarded by explicit cutover approval because `nnn/main` continues serving current production subsites during development.

`release-nnn.sh` accepts an explicit Git ref/commit only and requires `NNN_CUTOVER_APPROVED=YES`. It validates the built contract v2 before switching `/srv/site-manager/nnn/current`.

## Secrets and persistent state

Secrets live under `/etc/site-manager` and are not stored in Git. Persistent state lives under `/srv/site-manager/data` and is not inside release folders.

The Site Manager systemd unit has a read-only system filesystem except for `/srv/site-manager/data` and `/etc/caddy/sites`. Caddy and Site Manager share only the `site-manager-runtime` Unix group where cross-service file access is required.

## Cutover controls

Host bootstrap defaults to `VPS_PUBLISH_MODE=plan`. Installing the host or a release cannot publish customer sites. Customer publication requires a separate, intentional change to `apply` after Caddy, DNS, the shared `nnn` release and end-to-end staging have passed.

The base Caddyfile is validated during host setup but is activated only when the operator sets `CADDY_APPLY=YES`.

## Backup

A daily systemd timer creates a PostgreSQL custom-format dump plus archives of customer uploads and deployment state. Default retention is 14 days.

## Production branch rule

Until final cutover:

- `DukeNyamasege/nnn/main` remains the stable production source for current subsites.
- Site Manager/VPS `nnn` work stays in draft PR #48 (`hold/site-manager-v2-integration-2026-08-20`).
- Step 8 does not merge that PR and does not deploy it to a VPS.
