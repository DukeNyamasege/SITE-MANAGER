import express from 'express';
import { query, transaction } from './db.js';
import { requireAdmin, requireAuthenticatedUser } from './session.js';

const router = express.Router();
router.use(requireAuthenticatedUser, requireAdmin);

const cleanEmail = value => String(value || '').trim().toLowerCase();
const cleanHost = value => String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');

function shapeImport(row) {
  return {
    id: row.id,
    legacy_site_id: row.legacy_site_id,
    display_domain: row.display_domain,
    hosts: row.hosts || [],
    source_commit: row.source_commit,
    source_fingerprint: row.source_fingerprint,
    customization_source: row.customization_source,
    free_bot_manifest_path: row.free_bot_manifest_path,
    status: row.status,
    drift_status: row.drift_status,
    assigned_owner: row.assigned_user_id ? {
      id: row.assigned_user_id,
      email: row.owner_email,
      display_name: row.owner_display_name || '',
    } : null,
    website_id: row.website_id,
    assigned_at: row.assigned_at,
    last_audited_at: row.last_audited_at,
  };
}

router.get('/legacy-sites', async (_request, response, next) => {
  try {
    const result = await query(
      `SELECT i.*, u.email AS owner_email, u.display_name AS owner_display_name
         FROM legacy_nnn_site_imports i
         LEFT JOIN users u ON u.id = i.assigned_user_id
        ORDER BY CASE i.status WHEN 'unassigned' THEN 0 WHEN 'assigned' THEN 1 ELSE 2 END,
                 i.display_domain ASC`,
    );
    const summary = {
      total: result.rows.length,
      unassigned: result.rows.filter(row => row.status === 'unassigned').length,
      assigned: result.rows.filter(row => row.status === 'assigned').length,
      drifted: result.rows.filter(row => row.drift_status === 'drifted').length,
    };
    return response.json({ summary, sites: result.rows.map(shapeImport) });
  } catch (error) { return next(error); }
});

router.post('/legacy-sites/:siteId/assign', async (request, response, next) => {
  try {
    const ownerEmail = cleanEmail(request.body?.owner_email);
    if (!ownerEmail || !ownerEmail.includes('@')) return response.status(400).json({ message: 'A valid existing customer email is required.' });

    const result = await transaction(async client => {
      const importResult = await client.query(
        `SELECT * FROM legacy_nnn_site_imports WHERE legacy_site_id = $1 FOR UPDATE`,
        [request.params.siteId],
      );
      const item = importResult.rows[0];
      if (!item) {
        const error = new Error('Legacy nnn site is not in the audited migration inventory.');
        error.status = 404;
        throw error;
      }
      if (item.status === 'ignored') {
        const error = new Error('This legacy site is marked ignored. Restore it in the migration inventory before assignment.');
        error.status = 409;
        throw error;
      }

      const ownerResult = await client.query(
        `SELECT id, email, display_name FROM users
          WHERE LOWER(email) = LOWER($1)
            AND status = 'active'
            AND email_verified_at IS NOT NULL
          LIMIT 1`,
        [ownerEmail],
      );
      const owner = ownerResult.rows[0];
      if (!owner) {
        const error = new Error('The owner must already have an active verified Site Manager account.');
        error.status = 404;
        throw error;
      }

      if (item.status === 'assigned') {
        if (item.assigned_user_id !== owner.id) {
          const error = new Error('This legacy site is already assigned to a different Site Manager account.');
          error.status = 409;
          throw error;
        }
        const currentWebsite = await client.query('SELECT * FROM websites WHERE id = $1', [item.website_id]);
        return { item, owner, website: currentWebsite.rows[0], created: false };
      }

      const existingKey = await client.query('SELECT id, owner_user_id, source FROM websites WHERE site_key = $1 LIMIT 1', [item.legacy_site_id]);
      if (existingKey.rows[0]) {
        const error = new Error('The legacy site key already exists in V2 and requires manual conflict review.');
        error.status = 409;
        throw error;
      }

      const hosts = Array.isArray(item.hosts) ? item.hosts.map(cleanHost).filter(Boolean) : [];
      const primaryHost = cleanHost(item.display_domain);
      const allHosts = [...new Set([primaryHost, ...hosts].filter(Boolean))];
      const hostConflict = await client.query(
        `SELECT hostname FROM website_domains WHERE LOWER(hostname) = ANY($1::text[]) LIMIT 1`,
        [allHosts.map(host => host.toLowerCase())],
      );
      if (hostConflict.rows[0]) {
        const error = new Error(`Hostname ${hostConflict.rows[0].hostname} already belongs to another V2 website.`);
        error.status = 409;
        throw error;
      }

      const websiteResult = await client.query(
        `INSERT INTO websites
           (owner_user_id, name, site_key, template_id, source, status, primary_domain, domain_status, deployment_status)
         VALUES ($1, $2, $3, 'nnn', 'migrated', 'ready', $4, 'pending', 'not_deployed')
         RETURNING *`,
        [owner.id, primaryHost, item.legacy_site_id, primaryHost],
      );
      const website = websiteResult.rows[0];

      await client.query(
        `INSERT INTO website_subscriptions (website_id, price_cents, currency, billing_status)
         VALUES ($1, 1000, 'USD', 'not_started')`,
        [website.id],
      );

      const customization = item.customization || {};
      await client.query(
        `INSERT INTO website_configs
           (website_id, brand_name, tagline, navigation, colors, deriv_client_id,
            deriv_scopes, deriv_environment, setup_step, configuration_status, completed_at)
         VALUES ($1, $2, 'SMART DERIV TOOLS', $3::jsonb, $4::jsonb, $5, $6::jsonb, $7, 5, 'complete', NOW())`,
        [
          website.id,
          primaryHost,
          JSON.stringify(customization.navigation || []),
          JSON.stringify(customization.colors || {}),
          item.deriv_client_id,
          JSON.stringify(item.deriv_scopes || ['trade', 'application_read']),
          item.deriv_environment === 'staging' ? 'staging' : 'production',
        ],
      );

      for (const host of allHosts) {
        await client.query(
          `INSERT INTO website_domains
             (website_id, hostname, kind, is_primary, ownership_status, routing_status, ssl_status, ownership_verified_at)
           VALUES ($1, $2, 'custom', $3, 'verified', 'pending', 'pending', NOW())`,
          [website.id, host, host === primaryHost],
        );
      }

      await client.query(
        `UPDATE legacy_nnn_site_imports
            SET status = 'assigned', assigned_user_id = $1, website_id = $2,
                assigned_source_fingerprint = source_fingerprint,
                drift_status = 'current', assigned_at = NOW(), updated_at = NOW()
          WHERE id = $3`,
        [owner.id, website.id, item.id],
      );

      return { item, owner, website, created: true };
    });

    return response.status(result.created ? 201 : 200).json({
      ok: true,
      created: result.created,
      legacy_site_id: result.item.legacy_site_id,
      owner: { id: result.owner.id, email: result.owner.email, display_name: result.owner.display_name || '' },
      website: {
        id: result.website.id,
        site_key: result.website.site_key,
        name: result.website.name,
        source: result.website.source,
        status: result.website.status,
        primary_domain: result.website.primary_domain,
        deployment_status: result.website.deployment_status,
      },
      production_cutover_performed: false,
    });
  } catch (error) { return next(error); }
});

router.post('/legacy-sites/:siteId/ignore', async (request, response, next) => {
  try {
    const result = await query(
      `UPDATE legacy_nnn_site_imports
          SET status = 'ignored', drift_status = 'not_assigned', updated_at = NOW()
        WHERE legacy_site_id = $1 AND status = 'unassigned'
        RETURNING legacy_site_id`,
      [request.params.siteId],
    );
    if (!result.rows[0]) return response.status(409).json({ message: 'Only unassigned legacy sites can be ignored.' });
    return response.json({ ok: true, legacy_site_id: result.rows[0].legacy_site_id });
  } catch (error) { return next(error); }
});

export default router;
