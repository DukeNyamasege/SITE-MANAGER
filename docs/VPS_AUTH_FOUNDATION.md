# Site Manager V2 — VPS Authentication Foundation

This document describes Step 2 of the Site Manager V2 rebuild.

## Target architecture

`SITE-MANAGER` is the control plane. `DukeNyamasege/nnn` remains the reusable website template/runtime.

The completed customer journey remains:

1. Create a Site Manager account.
2. Verify the email address and sign in.
3. Create a website even if the customer has no existing site or domain.
4. Configure the website from the shared `nnn` template.
5. Preview it.
6. Connect or purchase a domain.
7. Publish/deploy it.
8. Manage it from My Websites.
9. Bill each active website at USD 10 per month.

Step 2 implements the customer identity boundary that every later website and billing record will reference.

## New VPS-native components

- `server/index.js` — Node/Express Site Manager API server.
- `server/db.js` — PostgreSQL connection pool.
- `server/auth.js` — registration, verification, login, session, logout and password recovery APIs.
- `server/security.js` — Argon2id passwords, opaque tokens and secure cookie helpers.
- `server/mailer.js` — SMTP verification and password-reset email delivery.
- `server/migrations/001_auth.sql` — users, sessions, email verification and password reset tables.
- `scripts/migrate.mjs` — ordered PostgreSQL migration runner.
- `src/auth.tsx` — React account UI and authentication state.

## Security model

Passwords are never stored directly. They are hashed using Argon2id.

The browser never receives a password hash or database session identifier. Login creates a random opaque session token. Only the SHA-256 hash of that token is stored in PostgreSQL. The raw token is sent only through an HttpOnly, SameSite cookie and uses `Secure` in production.

Email verification and password-reset tokens are also stored only as SHA-256 hashes. Password reset revokes all previous sessions before creating a new one.

Unsafe API requests are restricted to the configured `APP_URL` origin, and sensitive account endpoints have rate limits.

## Local development

Create `.env` from `.env.example`, create a PostgreSQL database, then run:

```bash
npm install
npm run db:migrate
npm run dev:server
```

In another terminal:

```bash
npm run dev:web
```

The Vite application runs on its normal development port and proxies `/api/v2/*` to `http://localhost:8787`.

When SMTP is not configured in development, set `AUTH_DEV_RETURN_LINKS=true` to expose the verification/reset development link in the account UI. This option must not be enabled in production.

## VPS production requirements

Before production activation the VPS will need:

- Node.js 22 or newer
- PostgreSQL
- HTTPS reverse proxy
- production `DATABASE_URL`
- SMTP credentials
- `APP_URL` set to the final Site Manager HTTPS origin
- `NODE_ENV=production`
- `AUTH_DEV_RETURN_LINKS=false`

The current public Netlify site remains in maintenance mode. Netlify is still frozen through `netlify.deploy.json`; this authentication work does not deploy the unfinished V2 platform publicly.

## Next milestone

Step 3 creates the website ownership model and **My Websites** dashboard. Each site record will reference `users.id` and will later receive its own USD 10/month subscription lifecycle. Existing sites already configured in `nnn` will be migrated into that ownership model instead of being discarded.
