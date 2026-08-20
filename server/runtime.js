import express from 'express';
import { query } from './db.js';
import { hashToken } from './security.js';
import { normalizeDerivScopes, normalizeNnnColors, normalizeNnnNavigation } from './nnn-contract.js';

const router = express.Router();

const runtimeSelect = `
  SELECT w.id, w.site_key, w.name, w.status, w.primary_domain, w.domain_status,
         c.brand_name, c.tagline, c.logo_url, c.navigation, c.colors,
         c.deriv_client_id, c.deriv_scopes, c.deriv_environment, c.configuration_status
    FROM websites w
    JOIN website_configs c ON c.website_id = w.id
`;

function cleanHost(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

function shapeRuntime(row, mode, previewExpiresAt = null) {
  const primaryDomain = cleanHost(row.primary_domain);
  return {
    version: 1,
    mode,
    site: {
      id: row.site_key,
      name: row.name,
      brand_name: row.brand_name || row.name,
      tagline: row.tagline || 'SMART DERIV TOOLS',
      logo_url: row.logo_url || '',
      primary_domain: primaryDomain,
      display_domain: primaryDomain || `${row.site_key}.preview`,
    },
    customization: {
      navigation: normalizeNnnNavigation(row.navigation),
      colors: normalizeNnnColors(row.colors),
    },
    deriv: {
      client_id: row.deriv_client_id || '',
      scopes: normalizeDerivScopes(row.deriv_scopes),
      environment: row.deriv_environment === 'staging' ? 'staging' : 'production',
    },
    ...(mode === 'preview' ? { preview: { expires_at: previewExpiresAt } } : {}),
  };
}

router.get('/preview/:siteKey', async (request, response, next) => {
  try {
    const token = String(request.query.token || '').trim();
    if (!token) return response.status(401).json({ message: 'Preview token is required.' });

    const result = await query(
      `${runtimeSelect}
       JOIN website_preview_sessions p ON p.website_id = w.id
       WHERE w.site_key = $1
         AND p.token_hash = $2
         AND p.revoked_at IS NULL
         AND p.expires_at > NOW()
         AND w.status <> 'archived'
       LIMIT 1`,
      [request.params.siteKey, hashToken(token)],
    );
    const row = result.rows[0];
    if (!row) return response.status(401).json({ message: 'This private preview session is invalid or has expired.' });

    void query(
      `UPDATE website_preview_sessions SET last_used_at = NOW()
        WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashToken(token)],
    ).catch(() => {});

    const expiry = await query(
      `SELECT expires_at FROM website_preview_sessions
        WHERE token_hash = $1 AND revoked_at IS NULL LIMIT 1`,
      [hashToken(token)],
    );

    response.setHeader('Cache-Control', 'no-store, private');
    return response.json(shapeRuntime(row, 'preview', expiry.rows[0]?.expires_at || null));
  } catch (error) {
    return next(error);
  }
});

router.get('/site', async (request, response, next) => {
  try {
    const host = cleanHost(request.query.host);
    if (!host) return response.status(400).json({ message: 'Host is required.' });

    const result = await query(
      `${runtimeSelect}
       WHERE LOWER(REGEXP_REPLACE(COALESCE(w.primary_domain, ''), '^www\\.', '')) = $1
         AND w.domain_status = 'connected'
         AND w.status IN ('ready', 'deploying', 'live')
         AND c.configuration_status = 'complete'
       LIMIT 1`,
      [host],
    );
    const row = result.rows[0];
    if (!row) return response.status(404).json({ message: 'No managed runtime configuration exists for this host.' });

    response.setHeader('Cache-Control', 'no-store');
    return response.json(shapeRuntime(row, 'live'));
  } catch (error) {
    return next(error);
  }
});

export default router;
