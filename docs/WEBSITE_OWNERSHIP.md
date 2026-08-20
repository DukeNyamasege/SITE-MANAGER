# Site Manager V2 — Website Ownership Foundation

Step 3 makes the authenticated customer account the ownership boundary for every website.

## Core relationship

```text
users.id
   |
   +-- websites.owner_user_id
          |
          +-- website_subscriptions.website_id
```

A browser never supplies `owner_user_id`. The VPS server resolves the current customer from the opaque HttpOnly session cookie and scopes every website query to that user.

## Website identity

Each website has:

- its own UUID
- a stable globally unique `site_key`
- an owner (`owner_user_id`)
- `template_id`, currently `nnn`
- lifecycle status
- domain status and optional primary domain
- deployment status
- source (`created` or `migrated`)

The stable `site_key` is intended to become the bridge between the Site Manager database and per-site runtime configuration generated for `DukeNyamasege/nnn`.

## No-domain-first flow

A customer can create a website record without owning a domain. The initial record is a private draft:

```text
Account -> Create Website -> Draft website -> Step 4 builder -> Preview -> Domain -> Deploy
```

Step 3 intentionally does not provision a domain or deploy the template. Those operations belong to later milestones.

## Billing foundation

Every new website receives exactly one `website_subscriptions` row with:

- price: 1000 cents
- currency: USD
- billing status: `not_started`

This records the intended USD 10/month price per website without beginning charges prematurely.

The free-month trial, payment provider, renewals, past-due handling and cancellation enforcement will be implemented in the billing milestone. Until then, Step 3 only establishes the data relationship and visible plan information.

## Current V2 customer capabilities

- list owned websites
- create a private `nnn` draft without a domain
- rename an owned website
- archive an owned website while retaining its historical record
- view template, domain, deployment and billing state

## Security boundary

`GET`, `POST`, `PATCH` and archive actions under `/api/v2/websites` require an authenticated verified account. Read and mutation queries include the authenticated `owner_user_id`, preventing cross-customer website access through guessed UUIDs.

## Next milestone

Step 4 converts an owned draft into the full Create Website wizard: branding, feature selection, Deriv configuration, `nnn` site configuration, preview preparation and deployment readiness.
