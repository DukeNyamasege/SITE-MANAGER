# SITE-MANAGER

A small administration app for managing the domain-specific XML bot libraries deployed by `DukeNyamasege/nnn`.

## Domain access model

There is no global manager password and no domain dropdown after login.

The single login input is the domain to manage, in lowercase. For example:

```text
kicktrade.site
```

If that domain exists in `DukeNyamasege/nnn/brand.config.json`, the server creates a domain-scoped session. That session can only read, edit, publish, and monitor bot updates for that one site. To manage another site, use **Change domain**, then enter that other domain.

`www.` is normalized away when matching a configured domain, so a site configured as `www.kicktrade.site` is still accessed with `kicktrade.site`.

The session cookie is signed server-side using the existing `GITHUB_TOKEN`; no separate `MANAGER_PASSWORD` or `SESSION_SECRET` environment variable is required.

> Note: a domain name is public information, so this access model is intentionally domain-scoped rather than strong secret authentication. Anyone who knows a managed domain name could attempt to enter it. The server still strictly prevents a session for one domain from reading or publishing another domain.

## What version 1 does

- Resolves the entered domain against `DukeNyamasege/nnn/brand.config.json`.
- Shows only the currently published bot list for that authenticated domain.
- Accepts one or multiple Blockly `.xml` bot uploads.
- Lets the operator delete bots from that domain.
- Lets the operator drag bots into first-to-last display order.
- Publishes through a temporary GitHub branch and pull request.
- Waits for the target repository's `Node.js compatibility` workflow.
- Merges to target `main` only when that workflow succeeds.
- Netlify can then deploy the updated target repository normally.

The GitHub token never enters the React bundle. All GitHub reads/writes and session signing happen inside Netlify Functions.

## Target repository contract

The target repository reads domain manifests from:

```text
public/free-bots/domains/<site-id>.json
```

New XML assets created by this manager are stored under:

```text
public/free-bots/uploads/<site-id>/<generated-id>.xml
```

If a domain manifest does not yet exist, the manager displays the shared library from `public/free-bots/bots.json`. The first Publish creates that domain's independent manifest. Publishing an empty list intentionally gives that domain zero bots.

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
2. SITE-MANAGER locks the session to that domain and loads only its bot list.
3. Add/delete/reorder bots locally.
4. Click **Publish**.
5. SITE-MANAGER verifies again that the requested site matches the authenticated domain session.
6. It reads the latest target `main` SHA.
7. It creates a `bot-manager/<site>-<timestamp>` branch.
8. It writes the selected domain manifest and any new/deleted site-owned assets in one commit.
9. It opens a pull request to target `main`.
10. The browser polls only that domain's publish status while the target Node 22/24 workflow runs.
11. When validation succeeds, the backend merges the PR and removes the temporary branch.
12. Netlify sees the new target `main` revision and deploys the relevant sites.

A session authenticated for one domain is rejected if it tries to request another site's bot list, publish another site's manifest, or monitor/merge another site's Site Manager PR.

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
