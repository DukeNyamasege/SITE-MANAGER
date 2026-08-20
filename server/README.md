# Site Manager VPS Server

The V2 backend is a VPS-native Node/Express service backed by PostgreSQL.

Quickstart:

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev:server
```

Run the Vite frontend separately with:

```bash
npm run dev:web
```

The frontend proxies `/api/v2/*` to the VPS server on `http://localhost:8787` during development.

The legacy Netlify Functions under `netlify/functions` remain available only while existing site-management flows are migrated. New V2 backend work should be added under `server/`.
