# SITE-MANAGER

A domain-scoped control plane for websites served by `DukeNyamasege/nnn`.

SITE-MANAGER is intentionally **Netlify-only**. It does not require a VPS, Namecheap API key, fixed IP, or registrar automation. GitHub and Netlify tasks are automated; registrar DNS is the one manual infrastructure step.

## Domain entry

The access screen starts blank and does not expose a domain list or example domain. The user types the domain they want to work with.

- If the domain already exists in `nnn/brand.config.json`, SITE-MANAGER opens the **Existing Website Wizard** for only that domain.
- If the domain does not exist, SITE-MANAGER opens the **New Site Setup Wizard**.
- `www.` is normalized when resolving a configured domain.
- The server keeps every session scoped to exactly one site/domain.

## Existing Website Wizard

Existing sites use a five-step guided workflow instead of the old editor dropdown:

1. **Website** — review domain, site ID, website URL, Deriv redirect URI, client/App ID, environment and OAuth scopes.
2. **Navigation** — drag/reorder navigation items, remove optional sections, add available hidden sections, and customize theme colors.
3. **Bots** — upload XML bots, remove bots, and drag them into first-to-last order.
4. **Review** — see which areas have unpublished changes.
5. **Publish** — publish only the changed areas through GitHub validation and then Netlify deployment.

Changes made in Navigation and Bots are kept together in the wizard until Publish. If both areas changed, they are published sequentially so the Git history remains clear and each change gets the target Node 22/24 validation.

## New Site Setup Wizard

Unknown domains use a six-step wizard:

1. **Verify domain** — add a generated TXT record manually at the DNS provider and let the Netlify Function verify it after propagation.
2. **Deriv setup** — enter the Deriv OAuth client/App ID, environment and scopes for the exact HTTPS callback.
3. **Navigation** — choose the initial sections/order and theme colors.
4. **Bots** — optionally upload the initial XML bot library.
5. **Review** — review the complete site configuration.
6. **Deploy** — create the target GitHub provisioning PR, wait for Node 22/24 validation, merge it, attach the domain aliases to Netlify, and show the manual DNS records.

The Deriv application itself must already be registered at Deriv with the exact callback URI shown by the wizard. SITE-MANAGER stores and deploys that configuration; it does not create Deriv applications.

## Netlify-only domain flow

After source provisioning succeeds, SITE-MANAGER uses the Netlify API to attach both the apex domain and `www` alias to the configured Netlify site.

DNS remains manual by design. The wizard displays:

```text
@    ALIAS  -> apex-loadbalancer.netlify.com
www  CNAME  -> <your-site>.netlify.app
```

If the DNS provider does not support apex ALIAS records, the wizard also shows the Netlify fallback A record.

After the user updates DNS, the wizard provides **Check DNS & SSL**. The Netlify Function checks/provisions TLS using the Netlify API. No registrar credentials are stored anywhere in SITE-MANAGER.

## GitHub publishing

Bot and site settings updates use domain-specific Git messages such as:

```text
Update bots on kicktrade.site
Update navigation and theme on kicktrade.site
Provision new site riskmanagers.site
```

Every publish uses:

```text
SITE-MANAGER
  -> temporary target branch
  -> pull request
  -> Node 22 / Node 24 compatibility checks
  -> merge to nnn/main
  -> target Netlify deployment
```

The GitHub token never reaches the React bundle.

## Target repository contract

Bot manifests:

```text
public/free-bots/domains/<site-id>.json
```

Bot assets:

```text
public/free-bots/uploads/<site-id>/<generated-id>.xml
```

Navigation/theme catalog:

```text
public/site-config/catalog.json
```

Domain navigation/theme configuration:

```text
public/site-config/domains/<site-id>.json
```

New sites are also added to:

```text
brand.config.json -> sites.entries
```

## Netlify environment variables

Configure these as **server-side** environment variables on the SITE-MANAGER Netlify project:

```text
GITHUB_TOKEN=<GitHub token with target repo write/PR/workflow access>
TARGET_REPO=DukeNyamasege/nnn
TARGET_BRANCH=main

DOMAIN_VERIFICATION_SECRET=<optional random HMAC secret>

NETLIFY_ACCESS_TOKEN=<Netlify personal access token>
NETLIFY_SITE_ID=<target trading-template Netlify site ID>
NETLIFY_SITE_HOSTNAME=<target>.netlify.app
```

Do not prefix these values with `VITE_`.

There are deliberately **no** `PROVISIONER_*`, `NAMECHEAP_*`, VPS, or fixed-IP variables.

## Local development

Use Netlify Dev so frontend and functions share one origin:

```bash
npm install
npx netlify dev
```

For frontend-only work:

```bash
npm run dev
```

## Security notes

- Existing sessions are scoped to one configured `site_id`.
- Unknown domains must pass DNS TXT ownership verification before `provision-site` can write them to the target repository.
- The ownership check is repeated server-side; bypassing the browser wizard does not bypass verification.
- `GITHUB_TOKEN` and `NETLIFY_ACCESS_TOKEN` stay in Netlify Functions.
- XML files are limited to 1.5 MB and must contain Blockly XML/block structure.
- Registrar DNS credentials are never requested or stored.
