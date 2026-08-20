import express from 'express';
import { query } from './db.js';
import { requireAuthenticatedUser } from './session.js';
import { evaluateDualRunParity } from './parity-core.js';

const router = express.Router();
router.use(requireAuthenticatedUser);

async function parityContext(websiteId, userId) {
  const websiteResult = await query(
    `SELECT w.id, w.owner_user_id, w.name, w.site_key, w.source, w.status,
            w.primary_domain, w.domain_status, w.deployment_status, w.preview_approved_at,
            c.brand_name, c.tagline, c.logo_url, c.navigation, c.colors, c.deriv_client_id, c.deriv_scopes,
            c.deriv_environment, c.configuration_status
       FROM websites w
       JOIN website_configs c ON c.website_id = w.id
      WHERE w.id = $1 AND w.owner_user_id = $2 AND w.status <> 'archived'
      LIMIT 1`,
    [websiteId, userId],
  );
  const website = websiteResult.rows[0];
  if (!website) return null;

  const importResult = await query(
    `SELECT * FROM legacy_nnn_site_imports
      WHERE website_id = $1 AND status = 'assigned'
      LIMIT 1`,
    [website.id],
  );
  const importItem = importResult.rows[0] || null;

  const domainResult = await query(
    `SELECT id, hostname, kind, is_primary, ownership_status, routing_status, ssl_status
       FROM website_domains WHERE website_id = $1 ORDER BY hostname`,
    [website.id],
  );

  const reportResult = await query(
    `SELECT * FROM legacy_nnn_parity_reports WHERE website_id = $1 LIMIT 1`,
    [website.id],
  );

  return {
    website,
    config: website,
    importItem,
    domains: domainResult.rows,
    parityReport: reportResult.rows[0] || null,
  };
}

function shapeWebsite(row) {
  return {
    id: row.id,
    name: row.name,
    site_key: row.site_key,
    source: row.source,
    status: row.status,
    primary_domain: row.primary_domain,
    domain_status: row.domain_status,
    deployment_status: row.deployment_status,
    preview_approved_at: row.preview_approved_at,
  };
}

router.get('/', async (request, response, next) => {
  try {
    const result = await query(
      `SELECT w.id
         FROM websites w
         JOIN legacy_nnn_site_imports i ON i.website_id = w.id AND i.status = 'assigned'
        WHERE w.owner_user_id = $1 AND w.status <> 'archived'
        ORDER BY w.name ASC`,
      [request.authUser.id],
    );

    const websites = [];
    for (const row of result.rows) {
      const context = await parityContext(row.id, request.authUser.id);
      if (!context?.importItem) continue;
      const parity = evaluateDualRunParity(context);
      websites.push({
        ...shapeWebsite(context.website),
        drift_status: context.importItem.drift_status,
        source_commit: context.importItem.source_commit,
        source_fingerprint: context.importItem.source_fingerprint,
        parity_status: parity.status,
        cutover_ready: parity.cutover_ready,
        stored_parity_status: context.parityReport?.status || 'not_checked',
        checked_at: context.parityReport?.checked_at || null,
      });
    }

    return response.json({ websites });
  } catch (error) { return next(error); }
});

router.get('/:websiteId', async (request, response, next) => {
  try {
    const context = await parityContext(request.params.websiteId, request.authUser.id);
    if (!context) return response.status(404).json({ message: 'Website not found.' });
    if (!context.importItem || context.website.source !== 'migrated') {
      return response.status(409).json({ message: 'Cutover parity is only available for assigned legacy nnn migrations.' });
    }

    const parity = evaluateDualRunParity(context);
    return response.json({
      website: shapeWebsite(context.website),
      parity,
      evidence_checked_at: context.parityReport?.checked_at || null,
      note: 'Parity readiness is evidence only. It never changes DNS, VPS routing, deployment state, nnn/main or billing.',
    });
  } catch (error) { return next(error); }
});

export default router;
