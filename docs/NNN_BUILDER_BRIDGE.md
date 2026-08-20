# Site Manager V2 — Create Website / nnn Bridge

Step 4 turns an owned `websites` draft into a persistent, resumable `nnn` configuration.

## Customer flow

1. Create Website reserves an owned website record and stable `site_key`.
2. The builder opens immediately; no domain is required.
3. Identity saves website/brand name, tagline, and an optional HTTPS logo URL.
4. Appearance saves the five theme colors already consumed by `nnn`.
5. Features saves the ordered `nnn` navigation catalog. `dashboard` is always required.
6. Deriv setup stores current OAuth preparation. A Client/App ID may be deferred until before deployment.
7. Review completes the configuration and marks the website `ready` without publishing, deploying, or starting billing.

All builder APIs derive the owner from the authenticated VPS session. A browser never selects `owner_user_id`.

## PostgreSQL source of truth

`website_configs` is one-to-one with `websites` and stores:

- `brand_name`
- `tagline`
- `logo_url`
- ordered `navigation` JSON
- five-color `colors` JSON
- `deriv_client_id`
- `deriv_scopes`
- `deriv_environment`
- `setup_step`
- `configuration_status`
- completion timestamps

Draft saves are independent of GitHub and independent of a customer domain.

## Current nnn contract

The current runtime exposes twelve configurable navigation entries and five theme colors in `public/site-config/catalog.json` / `src/components/premium/site-customization.ts`.

Site Manager mirrors and validates this contract in `server/nnn-contract.js`.

A completed draft can be projected to:

```text
public/site-config/domains/<site_key>.json
```

with this shape:

```json
{
  "version": 1,
  "site_id": "<site_key>",
  "navigation": ["dashboard", "free_bots"],
  "colors": {
    "primary": "#059669",
    "secondary": "#19cba3",
    "nav_background": "#151d26",
    "nav_text": "#f3f6f8",
    "header_background": "#ffffff"
  }
}
```

## Registry bridge

`nnn` currently resolves OAuth/site identity through `brand.config.json -> sites.entries` by hostname. Site Manager therefore generates a registry entry only when both are present:

- customer domain
- Deriv Client/App ID

Until then, `registry_entry` is `null` and the website can still complete Step 4.

## Readiness distinction

`configuration_ready` means the Site Manager builder is complete.

`deployment_ready` additionally requires the domain and Deriv Client/App ID needed by the current `nnn` host/OAuth resolver.

This separation is intentional so a customer can start from nothing.

## Step 5 boundary

Step 5 should make the completed website render through the real `nnn` runtime before public deployment. It should also expand `nnn` first-class per-site branding so `brand_name`, `tagline`, and logo are consumed by the runtime instead of being only Site Manager draft metadata. Logo upload/storage can then replace the temporary external HTTPS URL field.
