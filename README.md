# SITE-MANAGER

A small administration app for managing the domain-specific XML bot libraries deployed by `DukeNyamasege/nnn`.

## What version 1 does

- Loads every managed domain from `DukeNyamasege/nnn/brand.config.json`.
- Shows the currently published bot list for the selected domain.
- Accepts one or multiple Blockly `.xml` bot uploads.
- Lets the operator delete bots from that domain.
- Lets the operator drag bots into first-to-last display order.
- Publishes through a temporary GitHub branch and pull request.
- Waits for the target repository's `Node.js compatibility` workflow.
- Merges to target `main` only when that workflow succeeds.
- Netlify can then deploy the updated target repository normally.

The GitHub token never enters the React bundle. All GitHub writes happen inside Netlify Functions.

## Target repository contract

The target repository is already prepared to read domain manifests from:

```text
public/free-bots/domains/<site-id>.json
```

New XML assets created by this manager are stored under:

```text
public/free-bots/uploads/<site-id>/<generated-id>.xml
```

If a domain manifest does not yet exist, the manager displays the shared library from `public/free-bots/bots.json`. The first Publish creates that domain's independent manifest. Publishing an empty list intentionally gives that domain zero bots.

## Netlify setup

Connect this repository to a new Netlify site. The included `netlify.toml` builds the React app and exposes the server functions under `/api/*`.

Create these **server-side Netlify environment variables**:

```text
GITHUB_TOKEN=<classic GitHub token with write access to DukeNyamasege/nnn>
TARGET_REPO=DukeNyamasege/nnn
TARGET_BRANCH=main
MANAGER_PASSWORD=<strong manager login password>
SESSION_SECRET=<random secret, at least 24 characters>
```

Do not prefix any secret with `VITE_`. Values prefixed with `VITE_` can be bundled into browser code.

### GitHub token

Use a token that can read/write the target repository, create branches and pull requests, read its Actions workflow status, and merge pull requests. Store it only in Netlify's server environment.

## Publish sequence

1. Select a domain.
2. Add/delete/reorder bots locally.
3. Click **Publish**.
4. SITE-MANAGER reads the latest target `main` SHA.
5. It creates a `bot-manager/<site>-<timestamp>` branch.
6. It writes the selected domain manifest and any new/deleted site-owned assets in one commit.
7. It opens a pull request to target `main`.
8. The browser polls the Site Manager status endpoint while the target Node 22/24 workflow runs.
9. When validation succeeds, the backend merges the PR and removes the temporary branch.
10. Netlify sees the new target `main` revision and deploys the relevant sites.

If target `main` changes and the PR conflicts, the manager refuses to merge; reload that domain and publish again.

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

- Authentication is an HttpOnly signed session cookie.
- `MANAGER_PASSWORD` is checked only by the server function.
- `GITHUB_TOKEN` and `SESSION_SECRET` are never returned to the client.
- Uploaded XML is limited to 1.5 MB per file and must contain Blockly XML/block structure.
- Only domain IDs present in the target `brand.config.json` can be published.
- Only assets owned by the selected domain under `uploads/<site-id>/` are eligible for automatic deletion.
