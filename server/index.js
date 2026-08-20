import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import authRouter from './auth.js';
import adminRouter from './admin.js';
import cutoverRouter from './cutover.js';
import canaryRouter from './canary.js';
import stagingEdgeRouter from './staging-edge.js';
import websitesRouter from './websites.js';
import builderRouter from './builder.js';
import previewRouter from './preview.js';
import runtimeRouter from './runtime.js';
import domainsRouter from './domains.js';
import deploymentsRouter from './deployments.js';
import parityRouter from './parity.js';
import { uploadsRoot } from './uploads.js';
import { getPool } from './db.js';
import { startStagingEdgeMonitor, stopStagingEdgeMonitor } from './staging-edge-monitor.js';

const app = express();
const port = Number(process.env.PORT || 8787);
const appOrigin = process.env.APP_URL ? new URL(process.env.APP_URL).origin : '';

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-origin' } }));
app.use(express.json({ limit: '64kb' }));

app.use((request, response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || !appOrigin) return next();
  const origin = request.headers.origin;
  if (origin && origin !== appOrigin) return response.status(403).json({ message: 'Cross-origin request blocked.' });
  return next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many account requests. Try again later.' },
});

const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many attempts. Try again later.' },
});

const websiteMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: request => ['GET', 'HEAD', 'OPTIONS'].includes(request.method),
  message: { message: 'Too many website changes. Try again later.' },
});

app.get('/api/v2/health', async (_request, response, next) => {
  try {
    await getPool().query('SELECT 1');
    response.json({ ok: true, service: 'site-manager-v2', database: 'connected' });
  } catch (error) {
    next(error);
  }
});

app.use('/uploads', express.static(uploadsRoot, { maxAge: '1h', immutable: false, fallthrough: false }));
app.use('/api/v2/runtime', runtimeRouter);

app.use('/api/v2/auth', authLimiter);
app.use('/api/v2/auth/login', sensitiveLimiter);
app.use('/api/v2/auth/register', sensitiveLimiter);
app.use('/api/v2/auth/forgot-password', sensitiveLimiter);
app.use('/api/v2/auth/reset-password', sensitiveLimiter);
app.use('/api/v2/auth', authRouter);

app.use('/api/v2/websites', websiteMutationLimiter, websitesRouter);
app.use('/api/v2/builder', websiteMutationLimiter, builderRouter);
app.use('/api/v2/preview', websiteMutationLimiter, previewRouter);
app.use('/api/v2/domains', websiteMutationLimiter, domainsRouter);
app.use('/api/v2/deployments', websiteMutationLimiter, deploymentsRouter);
app.use('/api/v2/parity', websiteMutationLimiter, parityRouter);
app.use('/api/v2/admin/cutover', websiteMutationLimiter, cutoverRouter);
app.use('/api/v2/admin/canary', websiteMutationLimiter, canaryRouter);
app.use('/api/v2/admin/staging-edge', websiteMutationLimiter, stagingEdgeRouter);
app.use('/api/v2/admin', websiteMutationLimiter, adminRouter);

if (process.env.NODE_ENV === 'production') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(__dirname, '..', 'dist');
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (_request, response) => response.sendFile(path.join(dist, 'index.html')));
}

app.use((error, _request, response, _next) => {
  console.error(error);
  const status = Number(error?.status) || 500;
  response.status(status).json({
    message: status >= 500 ? 'The Site Manager server could not complete this request.' : String(error.message || 'Request failed.'),
  });
});

const server = app.listen(port, () => {
  console.log(`Site Manager VPS server listening on port ${port}`);
  startStagingEdgeMonitor();
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down Site Manager server.`);
  stopStagingEdgeMonitor();
  server.close(async () => {
    try { await getPool().end(); } catch {}
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
