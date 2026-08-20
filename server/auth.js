import express from 'express';
import { query, transaction } from './db.js';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  clientIp,
  hashPassword,
  hashToken,
  normalizeEmail,
  parseCookies,
  randomToken,
  sessionCookie,
  sessionExpiry,
  validateEmail,
  validatePassword,
  verifyPassword,
} from './security.js';
import { sendPasswordResetEmail, sendVerificationEmail } from './mailer.js';

const router = express.Router();

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name || '',
    email_verified: Boolean(row.email_verified_at),
    status: row.status,
    created_at: row.created_at,
  };
}

function safeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function developmentLink(result) {
  return process.env.NODE_ENV !== 'production' && process.env.AUTH_DEV_RETURN_LINKS === 'true'
    ? result.development_url
    : undefined;
}

async function createSession(client, userId, request) {
  const token = randomToken();
  const tokenHash = hashToken(token);
  const expiresAt = sessionExpiry();
  await client.query(
    `INSERT INTO user_sessions (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, String(request.headers['user-agent'] || '').slice(0, 500), clientIp(request).slice(0, 120), expiresAt],
  );
  return { token, expiresAt };
}

async function currentSession(request) {
  const raw = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!raw) return null;
  const tokenHash = hashToken(raw);
  const result = await query(
    `SELECT s.id AS session_id, s.user_id, s.expires_at, s.last_seen_at,
            u.id, u.email, u.display_name, u.email_verified_at, u.status, u.created_at
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
      LIMIT 1`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row || row.status !== 'active' || !row.email_verified_at) return null;

  if (!row.last_seen_at || Date.now() - new Date(row.last_seen_at).getTime() > 60 * 60 * 1000) {
    void query('UPDATE user_sessions SET last_seen_at = NOW() WHERE id = $1', [row.session_id]).catch(() => {});
  }
  return { row, raw, tokenHash };
}

router.post('/register', async (request, response, next) => {
  try {
    const email = validateEmail(request.body?.email);
    const password = String(request.body?.password || '');
    const displayName = safeName(request.body?.display_name);
    if (!email) return response.status(400).json({ message: 'Enter a valid email address.' });
    const passwordError = validatePassword(password);
    if (passwordError) return response.status(400).json({ message: passwordError });

    const passwordHash = await hashPassword(password);
    const verificationToken = randomToken();
    const verificationHash = hashToken(verificationToken);

    await transaction(async client => {
      const existing = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
      if (existing.rows[0]) {
        const error = new Error('An account already exists for this email. Sign in or resend verification.');
        error.status = 409;
        throw error;
      }

      const created = await client.query(
        `INSERT INTO users (email, password_hash, display_name)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [email, passwordHash, displayName],
      );
      await client.query(
        `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
        [created.rows[0].id, verificationHash],
      );
    });

    const mail = await sendVerificationEmail(email, verificationToken);
    return response.status(201).json({
      ok: true,
      verification_required: true,
      message: 'Account created. Check your email to verify your account.',
      development_verification_url: developmentLink(mail),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/resend-verification', async (request, response, next) => {
  try {
    const email = normalizeEmail(request.body?.email);
    const generic = { ok: true, message: 'If that account needs verification, a new email has been sent.' };
    if (!validateEmail(email)) return response.json(generic);

    const userResult = await query(
      `SELECT id, email, email_verified_at, status FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email],
    );
    const user = userResult.rows[0];
    if (!user || user.email_verified_at || user.status !== 'active') return response.json(generic);

    const token = randomToken();
    await transaction(async client => {
      await client.query(
        'UPDATE email_verification_tokens SET consumed_at = NOW() WHERE user_id = $1 AND consumed_at IS NULL',
        [user.id],
      );
      await client.query(
        `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
        [user.id, hashToken(token)],
      );
    });
    const mail = await sendVerificationEmail(user.email, token);
    return response.json({ ...generic, development_verification_url: developmentLink(mail) });
  } catch (error) {
    next(error);
  }
});

router.post('/verify-email', async (request, response, next) => {
  try {
    const token = String(request.body?.token || '');
    if (!token) return response.status(400).json({ message: 'Verification token is required.' });

    const result = await transaction(async client => {
      const tokenResult = await client.query(
        `SELECT t.id AS token_id, t.user_id, t.expires_at, t.consumed_at,
                u.id, u.email, u.display_name, u.email_verified_at, u.status, u.created_at
           FROM email_verification_tokens t
           JOIN users u ON u.id = t.user_id
          WHERE t.token_hash = $1
          FOR UPDATE`,
        [hashToken(token)],
      );
      const row = tokenResult.rows[0];
      if (!row || row.consumed_at || new Date(row.expires_at).getTime() <= Date.now()) {
        const error = new Error('This verification link is invalid or has expired.');
        error.status = 400;
        throw error;
      }
      if (row.status !== 'active') {
        const error = new Error('This account is not active.');
        error.status = 403;
        throw error;
      }

      await client.query('UPDATE email_verification_tokens SET consumed_at = NOW() WHERE id = $1', [row.token_id]);
      await client.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW() WHERE id = $1', [row.user_id]);
      const session = await createSession(client, row.user_id, request);
      return { user: publicUser({ ...row, email_verified_at: row.email_verified_at || new Date() }), session };
    });

    response.setHeader('Set-Cookie', sessionCookie(result.session.token));
    return response.json({ ok: true, user: result.user });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (request, response, next) => {
  try {
    const email = validateEmail(request.body?.email);
    const password = String(request.body?.password || '');
    if (!email || !password) return response.status(400).json({ message: 'Email and password are required.' });

    const userResult = await query(
      `SELECT id, email, password_hash, display_name, email_verified_at, status, created_at
         FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email],
    );
    const user = userResult.rows[0];
    const valid = user ? await verifyPassword(user.password_hash, password) : false;
    if (!user || !valid) return response.status(401).json({ message: 'Invalid email or password.' });
    if (user.status !== 'active') return response.status(403).json({ message: 'This account is not active.' });
    if (!user.email_verified_at) {
      return response.status(403).json({ code: 'EMAIL_NOT_VERIFIED', message: 'Verify your email before signing in.' });
    }

    const session = await transaction(client => createSession(client, user.id, request));
    response.setHeader('Set-Cookie', sessionCookie(session.token));
    return response.json({ ok: true, user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.get('/session', async (request, response, next) => {
  try {
    const session = await currentSession(request);
    if (!session) return response.status(401).json({ message: 'Not authenticated.' });
    return response.json({ ok: true, user: publicUser(session.row) });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', async (request, response, next) => {
  try {
    const raw = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (raw) await query('UPDATE user_sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(raw)]);
    response.setHeader('Set-Cookie', clearSessionCookie());
    return response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/forgot-password', async (request, response, next) => {
  try {
    const email = normalizeEmail(request.body?.email);
    const generic = { ok: true, message: 'If an eligible account exists, password reset instructions have been sent.' };
    if (!validateEmail(email)) return response.json(generic);

    const userResult = await query(
      `SELECT id, email, email_verified_at, status FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email],
    );
    const user = userResult.rows[0];
    if (!user || !user.email_verified_at || user.status !== 'active') return response.json(generic);

    const token = randomToken();
    await transaction(async client => {
      await client.query('UPDATE password_reset_tokens SET consumed_at = NOW() WHERE user_id = $1 AND consumed_at IS NULL', [user.id]);
      await client.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '60 minutes')`,
        [user.id, hashToken(token)],
      );
    });
    const mail = await sendPasswordResetEmail(user.email, token);
    return response.json({ ...generic, development_reset_url: developmentLink(mail) });
  } catch (error) {
    next(error);
  }
});

router.post('/reset-password', async (request, response, next) => {
  try {
    const token = String(request.body?.token || '');
    const password = String(request.body?.password || '');
    const passwordError = validatePassword(password);
    if (!token) return response.status(400).json({ message: 'Reset token is required.' });
    if (passwordError) return response.status(400).json({ message: passwordError });
    const passwordHash = await hashPassword(password);

    const result = await transaction(async client => {
      const tokenResult = await client.query(
        `SELECT t.id AS token_id, t.user_id, t.expires_at, t.consumed_at,
                u.id, u.email, u.display_name, u.email_verified_at, u.status, u.created_at
           FROM password_reset_tokens t
           JOIN users u ON u.id = t.user_id
          WHERE t.token_hash = $1
          FOR UPDATE`,
        [hashToken(token)],
      );
      const row = tokenResult.rows[0];
      if (!row || row.consumed_at || new Date(row.expires_at).getTime() <= Date.now()) {
        const error = new Error('This password reset link is invalid or has expired.');
        error.status = 400;
        throw error;
      }
      if (row.status !== 'active') {
        const error = new Error('This account is not active.');
        error.status = 403;
        throw error;
      }

      await client.query('UPDATE password_reset_tokens SET consumed_at = NOW() WHERE id = $1', [row.token_id]);
      await client.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, row.user_id]);
      await client.query('UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [row.user_id]);
      const session = await createSession(client, row.user_id, request);
      return { user: publicUser(row), session };
    });

    response.setHeader('Set-Cookie', sessionCookie(result.session.token));
    return response.json({ ok: true, user: result.user });
  } catch (error) {
    next(error);
  }
});

export default router;
