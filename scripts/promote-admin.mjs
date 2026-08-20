import 'dotenv/config';
import { getPool } from '../server/db.js';

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/promote-admin.mjs <verified-user-email>');
  process.exit(1);
}

const pool = getPool();
try {
  const result = await pool.query(
    `UPDATE users
        SET role = 'admin', updated_at = NOW()
      WHERE LOWER(email) = LOWER($1)
        AND status = 'active'
        AND email_verified_at IS NOT NULL
      RETURNING id, email, display_name, role`,
    [email],
  );
  if (!result.rows[0]) throw new Error('No active verified Site Manager user exists for that email.');
  console.log(JSON.stringify({ ok: true, user: result.rows[0] }, null, 2));
} finally {
  await pool.end();
}
