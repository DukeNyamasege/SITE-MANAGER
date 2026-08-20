# Step 7 — Shared `nnn` VPS publishing engine

## Deployment model

Site Manager is the control plane. `DukeNyamasege/nnn` is the single shared customer-site runtime.

A customer publish does **not** clone, build, or deploy another copy of `nnn`. Instead it creates a versioned `website_deployments` record and a hostname route that points to the one shared `nnn` distribution.

```text
customer-a.com ─┐
customer-b.com ─┼─> Caddy ─> /srv/site-manager/nnn/current
customer-c.com ─┘                 │
                                  ├─ /api/v2/runtime/* -> Site Manager :8787
                                  └─ /uploads/*        -> Site Manager :8787
```

The browser asks Site Manager for the configuration matching its hostname. PostgreSQL remains the source of truth for branding, navigation, colors, Deriv configuration, domains, routing and deployment identity.

## Publishing contract

Contract version: `2`.

The `nnn` build must contain `/site-manager-runtime.json` with:

- `runtime = nnn`
- `deployment_model = shared-static-runtime`
- `contract_version = 2`
- runtime API prefix `/api/v2/runtime`
- uploads prefix `/uploads`
- SPA fallback `/index.html`

A live Site Manager runtime response also includes the active deployment ID, runtime release and contract version. `nnn` understands these fields and rejects mismatched live deployment metadata.

## Plan vs apply

`VPS_PUBLISH_MODE=plan` is the safe development/default mode. Site Manager creates the deployment record, JSON manifest and Caddy route file, but the website is not marked live.

`VPS_PUBLISH_MODE=apply` is intended only for the production VPS. Apply mode requires:

1. a pinned `NNN_RUNTIME_RELEASE`,
2. the shared `nnn` build at `NNN_SHARED_DIST_DIR`,
3. the matching `site-manager-runtime.json`,
4. a Caddy base configuration that imports `CADDY_ROUTE_DIR/*.caddy`, and
5. permission for the Site Manager service to write route snippets and call Caddy validate/reload.

Apply mode validates the shared runtime, writes the hostname route atomically, validates/reloads Caddy and requests the hostname health resource over HTTPS. Only after that succeeds does the API mark the deployment `active`, the website `live` and the primary hostname SSL state `provisioned`.

If validation or health checking fails, the previous Caddy route is restored and reloaded before the deployment is marked failed.

## Technical publish gate

Publishing requires:

- complete website configuration,
- approved real `nnn` preview,
- primary hostname,
- ownership verified/not required,
- DNS routing ready,
- HTTPS eligible/provisioned,
- Deriv Client/App ID.

Billing is not checked and no payment state is changed.

## Version history

Every publish attempt receives its own UUID and stores:

- hostname,
- runtime release,
- contract version,
- plan/apply mode,
- generated manifest,
- route path,
- health URL,
- status and errors,
- prepared/activated/superseded timestamps.

Only one deployment may be `active` per website.

## Production VPS is not changed by this GitHub step

Step 7 builds the code and validates it in CI. The actual host filesystem, Caddy service, PostgreSQL instance and shared `nnn` release directory will be packaged in Step 8 before production cutover.
