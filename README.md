# SITE-MANAGER

A domain-scoped administration app for managing bot libraries and site navigation/theme settings deployed by `DukeNyamasege/nnn`.

## Domain access model

There is no global manager password and no domain dropdown after login.

The single login input is the domain to manage, in lowercase. For example:

```text
kicktrade.site
```

If that domain exists in `DukeNyamasege/nnn/brand.config.json`, the server creates a domain-scoped session. That session can only read, edit, publish, and monitor updates for that one site. To manage another site, use **Change domain**, then enter that other domain.

`www.` is normalized away when matching a configured domain, so a site configured as `www.kicktrade.site` is still accessed with `kicktrade.site`.

The session cookie is signed server-side using the existing `GITHUB_TOKEN`; no separate `MANAGER_PASSWORD` or `SESSION_SECRET` environment variable is required.

> Note: a domain name is public information, so this access model is intentionally domain-scoped rather than strong secret authentication. Anyone who knows a managed domain name could attempt to enter it. The server still strictly prevents a session for one domain from reading or publishing another domain.

## Editors

After login, the operator chooses what to update:

### Bot Library

- Shows only the currently published bot list for the authenticated domain.
- Accepts one or multiple Blockly `.xml` bot uploads.
- Lets the operator delete bots from that domain.
- Lets the operator drag bots into first-to-last display order.
- Bot publish commits use a clear subject such as `Update bots on kicktrade.site` and include added/removed bot names plus whether order changed.

### Navigation & Theme

- Loads the navigation feature catalog from `DukeNyamasege/nnn/public/site-config/catalog.json`.
- Shows the current navigation items for that domain.
- Lets the operator drag visible features into a new order.
- Lets the operator remove optional features.
- Lets the operator add back only features already available in the target template.
- Keeps required items such as Dashboard from being removed.
- Lets the operator change primary, secondary, navigation background, navigation text, and header background colors.
- Publishes a domain-specific configuration to `public/site-config/domains/<site-id>.json`.

Both editors publish through a temporary GitHub branch and pull request, wait for the target `Node.js compatibility` workflow, and merge to target `main` only when validation succeeds. Netlify then deploys the updated target repository normally.

The GitHub token never enters the React bundle. All GitHub reads/writes and session signing happen inside Netlify Functions.

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

If a bot manifest does not yet exist, the manager displays the shared library from `public/free-bots/bots.json`. If a site customization file does not exist, the manager displays the defaults from `public/site-config/catalog.json`. The first Publish creates that domain's independent configuration.

## Netlify setup

Connect this repository to a Netlify site. The included `netlify.toml` builds the React app and exposes the server functions under `/api/*`.

Create these **server-side Netlify environment variables**:

```text
GITHUB_TOKEN=<classic GitHub token with write access to DukeNyamasege/nnn>
TARGET_REPO=DukeNyamasege/nnn
TARGET_BRANCH=main
```

Do not prefix the GitHub token with `VITE_`. Values prefixed with `VITE_` can be bundled into browser code.

### GitHub token

Use a token that can read/write the target repository, create branches and pull requests, read its Actions workflow status, and merge pull requests. Store it only in Netlify's server environment.

## Publish sequence

1. Enter the lowercase domain to manage, for example `kicktrade.site`.
2. SITE-MANAGER locks the session to that domain.
3. Choose **Bot Library** or **Navigation & Theme**.
4. Make local changes.
5. Click **Publish**.
6. SITE-MANAGER verifies again that the requested site matches the authenticated domain session.
7. It reads the latest target `main` SHA.
8. It creates a domain-scoped temporary branch.
9. It writes the selected domain configuration in a commit whose subject includes the domain.
10. It opens a pull request to target `main`.
11. The browser polls only that domain's publish status while the target Node 22/24 workflow runs.
12. When validation succeeds, the backend merges the PR and removes the temporary branch.
13. Netlify sees the new target `main` revision and deploys the relevant sites.

A session authenticated for one domain is rejected if it tries to request another site's data, publish another site's configuration, or monitor/merge another site's Site Manager PR.

## Local development

Create a local `.env` from `.env.example`, then run with Netlify Dev so the functions and frontend share one origin:

```bash
npm install
npx netlify dev
```

For frontend-only work:

```bash
npm run dev
```

## Security notes

- The single login value is the configured domain name, normalized to lowercase and without `www.`.
- The HttpOnly cookie contains the authorized `site_id` and is HMAC-signed server-side with the GitHub token.
- `GITHUB_TOKEN` is never returned to the client.
- Every domain-sensitive API verifies the authenticated `site_id` before reading or writing.
- Uploaded XML is limited to 1.5 MB per file and must contain Blockly XML/block structure.
- Only domain IDs present in the target `brand.config.json` can be published.
- Only assets owned by the authenticated domain under `uploads/<site-id>/` are eligible for automatic deletion.
