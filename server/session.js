import { query } from './db.js';
import { SESSION_COOKIE, hashToken, parseCookies } from './security.js';

export async function authenticatedUser(request) {
  const raw = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!raw) return null;

  const result = await query(
    `SELECT u.id, u.email, u.display_name, u.email_verified_at, u.status, u.created_at,
            s.id AS session_id, s.last_seen_at
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
      LIMIT 1`,
    [hashToken(raw)],
  );

  const row = result.rows[0];
  if (!row || row.status !== 'active' || !row.email_verified_at) return null;

  if (!row.last_seen_at || Date.now() - new Date(row.last_seen_at).getTime() > 60 * 60 * 1000) {
    void query('UPDATE user_sessions SET last_seen_at = NOW() WHERE id = $1', [row.session_id]).catch(() => {});
  }

  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name || '',
    email_verified: true,
    status: row.status,
    created_at: row.created_at,
  };
}

export async function requireAuthenticatedUser(request, response, next) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return response.status(401).json({ message: 'Not authenticated.' });
    request.authUser = user;
    return next();
  } catch (error) {
    return next(error);
  }
}
