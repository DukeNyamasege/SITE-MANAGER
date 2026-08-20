import express from 'express';
import { query, transaction } from './db.js';
import { hashToken, randomToken } from './security.js';
import { requireAuthenticatedUser } from './session.js';
import { saveWebsiteLogo } from './uploads.js';

const router = express.Router();
router.use(requireAuthenticatedUser);

async function ownedWebsite(websiteId, userId) {
  const result = await query(
    `SELECT w.id, w.site_key, w.name, w.status, c.configuration_status
       FROM websites w
       JOIN website_configs c ON c.website_id = w.id
      WHERE w.id = $1 AND w.owner_user_id = $2 AND w.status <> 'archived'
      LIMIT 1`,
    [websiteId, userId],
  );
  return result.rows[0] || null;
}

function previewUrl(siteKey, token, screen) {
  const base = String(process.env.NNN_PREVIEW_URL || 'https://localhost:8443').trim();
  const url = new URL(base);
  url.searchParams.set('sm_preview', siteKey);
  url.searchParams.set('sm_token', token);
  url.searchParams.set('sm_screen', screen);
  return url.toString();
}

router.post('/:websiteId/session', async (request, response, next) => {
  try {
    const website = await ownedWebsite(request.params.websiteId, request.authUser.id);
    if (!website) return response.status(404).json({ message: 'Website not found.' });

    const token = randomToken(32);
    const ttlMinutes = Math.max(5, Math.min(240, Number(process.env.PREVIEW_TTL_MINUTES || 60)));
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await transaction(async client => {
      await client.query(
        `UPDATE website_preview_sessions
            SET revoked_at = NOW()
          WHERE website_id = $1 AND revoked_at IS NULL`,
        [website.id],
      );
      await client.query(
        `INSERT INTO website_preview_sessions (website_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [website.id, hashToken(token), expiresAt],
      );
    });

    return response.status(201).json({
      ok: true,
      site_key: website.site_key,
      expires_at: expiresAt,
      landing_preview_url: previewUrl(website.site_key, token, 'landing'),
      app_preview_url: previewUrl(website.site_key, token, 'app'),
    });
  } catch (error) {
    return next(error);
  }
});

router.put(
  '/:websiteId/logo',
  express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '2mb' }),
  async (request, response, next) => {
    try {
      const website = await ownedWebsite(request.params.websiteId, request.authUser.id);
      if (!website) return response.status(404).json({ message: 'Website not found.' });

      const logoUrl = await saveWebsiteLogo({
        websiteId: website.id,
        contentType: request.headers['content-type'],
        buffer: request.body,
      });

      await query(
        `UPDATE website_configs SET logo_url = $1, updated_at = NOW() WHERE website_id = $2`,
        [logoUrl, website.id],
      );
      return response.json({ ok: true, logo_url: logoUrl });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
