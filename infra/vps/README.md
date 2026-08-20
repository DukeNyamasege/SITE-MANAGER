# Site Manager + `nnn` VPS package

This directory is the production-host package for the shared VPS architecture.

## Production branch safety

`DukeNyamasege/nnn/main` is currently production for existing Netlify-managed subsites. Do not deploy or merge the Site Manager runtime integration from `main` during development.

The current integration is intentionally held in draft PR #48 on:

`hold/site-manager-v2-integration-2026-08-20`

`release-nnn.sh` requires `NNN_CUTOVER_APPROVED=YES` so a shared `nnn` runtime cannot be activated accidentally.

## Host roles

- Site Manager: Node.js service on `127.0.0.1:8787`.
- PostgreSQL: private database bound locally by the host's PostgreSQL configuration.
- Caddy: public HTTPS edge for the manager, preview hostname and customer hostnames.
- `nnn`: one static shared release at `/srv/site-manager/nnn/current`.
- Customer configuration: resolved from Site Manager/PostgreSQL at runtime; never copied into per-customer builds.

## Filesystem

```text
/srv/site-manager/
├── manager/
│   ├── releases/<timestamp>-<sha>/
│   └── current -> releases/...
├── nnn/
│   ├── releases/<timestamp>-<sha>/
│   └── current -> releases/...
├── builds/                    # temporary source/build workspaces
└── data/
    ├── uploads/               # persistent customer assets
    ├── deployments/           # manifests and planned routes
    └── backups/

/etc/site-manager/
├── site-manager.env           # non-database production settings
├── database.env               # DATABASE_URL; restricted
├── runtime.env                # active nnn source SHA
└── host.env                   # manager/preview/platform hostnames

/etc/caddy/
├── Caddyfile
└── sites/
    ├── 00-placeholder.caddy
    └── <customer-hostname>.caddy
```

Release directories are immutable application artifacts. Persistent uploads, database state and deployment state never live inside a release directory.

## Service account and permissions

`site-manager` is a non-login system user. `site-manager-runtime` is a shared Unix group used only where both Site Manager and Caddy need access, principally the generated Caddy route directory and shared static runtime.

The Node service runs without root and is hardened by systemd. It can write only its persistent data paths and `/etc/caddy/sites`. Caddy continues to own ports 80/443 and certificate management.

## Installation order

The scripts are not executed by CI and Step 8 does not touch a real VPS.

On a new approved Ubuntu/Debian VPS, the intended order is:

```bash
sudo ./infra/vps/install-prerequisites-ubuntu.sh

sudo SITE_MANAGER_DOMAIN=manager.example.com \
  NNN_PREVIEW_DOMAIN=preview.example.com \
  PLATFORM_SITE_BASE_DOMAIN=sites.example.com \
  CADDY_EMAIL=admin@example.com \
  ./infra/vps/install-host.sh

sudo ./infra/vps/provision-postgres.sh
sudo ./infra/vps/release-site-manager.sh <approved-site-manager-ref>
```

At that point Site Manager can run with `VPS_PUBLISH_MODE=plan`. No customer hostname needs to be activated.

Only at the final `nnn` production cutover:

```bash
sudo NNN_CUTOVER_APPROVED=YES \
  ./infra/vps/release-nnn.sh <explicitly-approved-nnn-commit>
```

Do not use `nnn/main` as that argument merely because it is the default branch. Use the exact tested integration commit approved for cutover.

After DNS and the host configuration are deliberately ready, the operator may enable Caddy and eventually change `VPS_PUBLISH_MODE=apply` in `/etc/site-manager/site-manager.env`. Those are separate production decisions.

## Dedicated preview hostname

The base Caddyfile serves `NNN_PREVIEW_DOMAIN` from the same `/srv/site-manager/nnn/current` build used by customer websites. `/api/v2/runtime/*` and `/uploads/*` are proxied to Site Manager. Preview identity is supplied by the short-lived preview token, so a customer domain is not required.

## Releases and rollback

`release-site-manager.sh`:

1. fetches exactly the supplied Git ref,
2. installs dependencies and builds,
3. prunes development packages,
4. writes an immutable release,
5. applies PostgreSQL migrations from the candidate release,
6. atomically switches `manager/current`,
7. restarts the Node service,
8. verifies `/api/v2/health`, and
9. restores the previous release automatically on failure.

`release-nnn.sh`:

1. requires explicit cutover approval,
2. fetches exactly the supplied Git ref,
3. builds `nnn`,
4. verifies `dist/site-manager-runtime.json` contract v2,
5. writes an immutable shared static release,
6. atomically switches `nnn/current`,
7. records the exact source SHA in `runtime.env`, and
8. restarts Site Manager so future deployment records pin that release.

Manual rollback helpers accept a release directory name:

```bash
sudo ./infra/vps/rollback-site-manager.sh <release-name>
sudo NNN_ROLLBACK_CONFIRMED=YES ./infra/vps/rollback-nnn.sh <release-name>
```

## Backups

`site-manager-backup.timer` runs daily and captures:

- a PostgreSQL custom-format dump,
- persistent uploads, and
- deployment manifests/state.

Default retention is 14 days and can be changed with `SITE_MANAGER_BACKUP_RETENTION_DAYS` in the systemd service environment if needed.

## What is deliberately absent

- no payment service or billing gate,
- no per-customer Node process,
- no per-customer `nnn` repository/build,
- no automatic merge/deploy from `nnn/main`,
- no production VPS mutation from GitHub CI,
- no automatic switch from publishing `plan` to `apply`.
