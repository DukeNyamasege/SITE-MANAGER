import express from 'express';
import { query } from './db.js';
import { hashToken } from './security.js';
import { normalizeDerivScopes, normalizeNnnColors, normalizeNnnNavigation } from './nnn-contract.js';

const router = express.Router();

const runtimeSelect = `
  SELECT w.id, w.site_key, w.name, w.source, w.status, w.primary_domain, w.domain_status,
         c.brand_name, c.tagline, c.logo_url, c.navigation, c.colors,
         c.deriv_client_id, c.deriv_scopes, c.deriv_environment, c.configuration_status,
         pd.hostname AS managed_hostname, pd.kind AS managed_domain_kind,
         pd.ownership_status AS managed_ownership_status,
         pd.routing_status AS managed_routing_status,
         pd.ssl_status AS managed_ssl_status,
         legacy.legacy_site_id, legacy.source_commit AS legacy_source_commit,
         legacy.source_fingerprint AS legacy_source_fingerprint,
         legacy.drift_status AS legacy_drift_status,
         dep.id AS deployment_id, dep.status AS deployment_status_record,
         dep.runtime_release AS deployment_runtime_release,
         dep.contract_version AS deployment_contract_version,
         dep.activated_at AS deployment_activated_at
    FROM websites w
    JOIN website_configs c ON c.website_id = w.id
    LEFT JOIN website_domains pd ON pd.website_id = w.id AND pd.is_primary = TRUE
    LEFT JOIN legacy_nnn_site_imports legacy ON legacy.website_id = w.id AND legacy.status = 'assigned'
    LEFT JOIN LATERAL (
      SELECT d.id, d.status, d.runtime_release, d.contract_version, d.activated_at
        FROM website_deployments d
       WHERE d.website_id = w.id AND d.status = 'active'
       ORDER BY d.activated_at DESC NULLS LAST, d.created_at DESC
       LIMIT 1
    ) dep ON TRUE
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
  const primaryDomain = cleanHost(row.managed_hostname || row.primary_domain);
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
    routing: {
      domain_kind: row.managed_domain_kind || null,
      ownership_status: row.managed_ownership_status || 'pending',
      routing_status: row.managed_routing_status || 'pending',
      ssl_status: row.managed_ssl_status || 'pending',
    },
    migration: row.source === 'migrated' && row.legacy_site_id ? {
      source: 'legacy-nnn',
      legacy_site_id: row.legacy_site_id,
      source_commit: row.legacy_source_commit,
      source_fingerprint: row.legacy_source_fingerprint,
      drift_status: row.legacy_drift_status || 'current',
      production_cutover_performed: false,
    } : null,
    deployment: row.deployment_id ? {
      id: row.deployment_id,
      status: row.deployment_status_record,
      runtime: 'nnn',
      runtime_release: row.deployment_runtime_release,
      contract_version: Number(row.deployment_contract_version || 2),
      activated_at: row.deployment_activated_at,
    } : null,
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
       WHERE LOWER(REGEXP_REPLACE(COALESCE(pd.hostname, w.primary_domain, ''), '^www\\.', '')) = $1
         AND pd.is_primary = TRUE
         AND pd.ownership_status IN ('verified', 'not_required')
         AND pd.routing_status = 'ready'
         AND pd.ssl_status IN ('eligible', 'provisioned')
         AND w.domain_status = 'connected'
         AND w.status = 'live'
         AND w.deployment_status = 'deployed'
         AND c.configuration_status = 'complete'
         AND dep.id IS NOT NULL
       LIMIT 1`,
      [host],
    );
    const row = result.rows[0];
    if (!row) return response.status(404).json({ message: 'No active Site Manager deployment exists for this host.' });

    response.setHeader('Cache-Control', 'no-store');
    return response.json(shapeRuntime(row, 'live'));
  } catch (error) {
    return next(error);
  }
});

export default router;
