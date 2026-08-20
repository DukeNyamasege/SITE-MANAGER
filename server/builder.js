import express from 'express';
import { query, transaction } from './db.js';
import { requireAuthenticatedUser } from './session.js';
import {
  NNN_DEFAULT_COLORS,
  NNN_DEFAULT_NAVIGATION,
  NNN_NAVIGATION_CATALOG,
  NNN_RECOMMENDED_SCOPES,
  builderReadiness,
  normalizeDerivScopes,
  normalizeNnnColors,
  normalizeNnnNavigation,
  toNnnRegistryEntry,
  toNnnSiteCustomization,
} from './nnn-contract.js';

const router = express.Router();
router.use(requireAuthenticatedUser);

function cleanText(value, max = 120) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function cleanLogoUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:') return null;
    return url.toString().slice(0, 1000);
  } catch {
    return null;
  }
}

function cleanClientId(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return /^[A-Za-z0-9_-]{4,120}$/.test(text) ? text : '';
}

async function ensureOwnedBuilder(websiteId, userId) {
  const owned = await query(
    `SELECT w.id, w.owner_user_id, w.name, w.site_key, w.template_id, w.status,
            w.primary_domain, w.domain_status, w.deployment_status,
            c.brand_name, c.tagline, c.logo_url, c.navigation, c.colors,
            c.deriv_client_id, c.deriv_scopes, c.deriv_environment,
            c.setup_step, c.configuration_status, c.completed_at,
            c.created_at AS config_created_at, c.updated_at AS config_updated_at
       FROM websites w
       LEFT JOIN website_configs c ON c.website_id = w.id
      WHERE w.id = $1 AND w.owner_user_id = $2 AND w.status <> 'archived'
      LIMIT 1`,
    [websiteId, userId],
  );
  let row = owned.rows[0];
  if (!row) return null;

  if (!row.config_created_at) {
    await query(
      `INSERT INTO website_configs (website_id, brand_name)
       VALUES ($1, $2)
       ON CONFLICT (website_id) DO NOTHING`,
      [websiteId, row.name],
    );
    const refreshed = await query(
      `SELECT w.id, w.owner_user_id, w.name, w.site_key, w.template_id, w.status,
              w.primary_domain, w.domain_status, w.deployment_status,
              c.brand_name, c.tagline, c.logo_url, c.navigation, c.colors,
              c.deriv_client_id, c.deriv_scopes, c.deriv_environment,
              c.setup_step, c.configuration_status, c.completed_at,
              c.created_at AS config_created_at, c.updated_at AS config_updated_at
         FROM websites w
         JOIN website_configs c ON c.website_id = w.id
        WHERE w.id = $1 AND w.owner_user_id = $2
        LIMIT 1`,
      [websiteId, userId],
    );
    row = refreshed.rows[0];
  }
  return row;
}

function shapeBuilder(row) {
  const website = {
    id: row.id,
    name: row.name,
    site_key: row.site_key,
    template_id: row.template_id,
    status: row.status,
    primary_domain: row.primary_domain,
    domain_status: row.domain_status,
    deployment_status: row.deployment_status,
  };
  const config = {
    brand_name: row.brand_name || row.name,
    tagline: row.tagline || 'SMART DERIV TOOLS',
    logo_url: row.logo_url || '',
    navigation: normalizeNnnNavigation(row.navigation),
    colors: normalizeNnnColors(row.colors),
    deriv_client_id: row.deriv_client_id || '',
    deriv_scopes: normalizeDerivScopes(row.deriv_scopes),
    deriv_environment: row.deriv_environment === 'staging' ? 'staging' : 'production',
    setup_step: Number(row.setup_step || 1),
    configuration_status: row.configuration_status || 'draft',
    completed_at: row.completed_at,
  };
  const readiness = builderReadiness(website, config);
  return {
    website,
    config,
    readiness,
    bridge: {
      customization_path: `public/site-config/domains/${website.site_key}.json`,
      customization: toNnnSiteCustomization(website, config),
      registry_entry: toNnnRegistryEntry(website, config),
    },
  };
}

async function respondBuilder(request, response) {
  const row = await ensureOwnedBuilder(request.params.websiteId, request.authUser.id);
  if (!row) return response.status(404).json({ message: 'Website not found.' });
  return response.json(shapeBuilder(row));
}

router.get('/catalog', (_request, response) => response.json({
  template_id: 'nnn',
  navigation_catalog: NNN_NAVIGATION_CATALOG,
  defaults: {
    navigation: NNN_DEFAULT_NAVIGATION,
    colors: NNN_DEFAULT_COLORS,
    deriv_scopes: NNN_RECOMMENDED_SCOPES,
    tagline: 'SMART DERIV TOOLS',
  },
}));

router.get('/:websiteId', async (request, response, next) => {
  try { return await respondBuilder(request, response); } catch (error) { return next(error); }
});

router.put('/:websiteId/identity', async (request, response, next) => {
  try {
    const row = await ensureOwnedBuilder(request.params.websiteId, request.authUser.id);
    if (!row) return response.status(404).json({ message: 'Website not found.' });

    const name = cleanText(request.body?.name, 100);
    const brandName = cleanText(request.body?.brand_name, 100) || name;
    const tagline = cleanText(request.body?.tagline, 120) || 'SMART DERIV TOOLS';
    const rawLogo = String(request.body?.logo_url || '').trim();
    const logoUrl = cleanLogoUrl(rawLogo);
    if (name.length < 2) return response.status(400).json({ message: 'Website name must be at least 2 characters.' });
    if (brandName.length < 2) return response.status(400).json({ message: 'Brand name must be at least 2 characters.' });
    if (rawLogo && !logoUrl) return response.status(400).json({ message: 'Logo URL must be a valid HTTPS address.' });

    await transaction(async client => {
      const duplicate = await client.query(
        `SELECT id FROM websites
          WHERE owner_user_id = $1 AND LOWER(name) = LOWER($2)
            AND id <> $3 AND status <> 'archived' LIMIT 1`,
        [request.authUser.id, name, request.params.websiteId],
      );
      if (duplicate.rows[0]) {
        const error = new Error('You already have a website with this name.');
        error.status = 409;
        throw error;
      }
      await client.query(
        `UPDATE websites SET name = $1, status = CASE WHEN status = 'draft' THEN 'configuring' ELSE status END, updated_at = NOW()
          WHERE id = $2 AND owner_user_id = $3`,
        [name, request.params.websiteId, request.authUser.id],
      );
      await client.query(
        `UPDATE website_configs
            SET brand_name = $1, tagline = $2, logo_url = $3,
                setup_step = GREATEST(setup_step, 2), configuration_status = 'in_progress', updated_at = NOW()
          WHERE website_id = $4`,
        [brandName, tagline, logoUrl, request.params.websiteId],
      );
    });
    return await respondBuilder(request, response);
  } catch (error) { return next(error); }
});

router.put('/:websiteId/appearance', async (request, response, next) => {
  try {
    const row = await ensureOwnedBuilder(request.params.websiteId, request.authUser.id);
    if (!row) return response.status(404).json({ message: 'Website not found.' });
    const provided = request.body?.colors;
    if (!provided || typeof provided !== 'object') return response.status(400).json({ message: 'Theme colors are required.' });
    const requiredKeys = Object.keys(NNN_DEFAULT_COLORS);
    for (const key of requiredKeys) {
      if (!/^#[0-9a-f]{6}$/i.test(String(provided[key] || ''))) {
        return response.status(400).json({ message: `${key.replace(/_/g, ' ')} must be a six-digit hex color.` });
      }
    }
    const colors = normalizeNnnColors(provided);
    await query(
      `UPDATE website_configs
          SET colors = $1::jsonb, setup_step = GREATEST(setup_step, 3), configuration_status = 'in_progress', updated_at = NOW()
        WHERE website_id = $2`,
      [JSON.stringify(colors), request.params.websiteId],
    );
    return await respondBuilder(request, response);
  } catch (error) { return next(error); }
});

router.put('/:websiteId/features', async (request, response, next) => {
  try {
    const row = await ensureOwnedBuilder(request.params.websiteId, request.authUser.id);
    if (!row) return response.status(404).json({ message: 'Website not found.' });
    const navigation = normalizeNnnNavigation(request.body?.navigation);
    await query(
      `UPDATE website_configs
          SET navigation = $1::jsonb, setup_step = GREATEST(setup_step, 4), configuration_status = 'in_progress', updated_at = NOW()
        WHERE website_id = $2`,
      [JSON.stringify(navigation), request.params.websiteId],
    );
    return await respondBuilder(request, response);
  } catch (error) { return next(error); }
});

router.put('/:websiteId/deriv', async (request, response, next) => {
  try {
    const row = await ensureOwnedBuilder(request.params.websiteId, request.authUser.id);
    if (!row) return response.status(404).json({ message: 'Website not found.' });
    const clientId = cleanClientId(request.body?.deriv_client_id);
    if (clientId === '') return response.status(400).json({ message: 'Deriv client ID contains unsupported characters.' });
    const scopes = normalizeDerivScopes(request.body?.deriv_scopes);
    const environment = request.body?.deriv_environment === 'staging' ? 'staging' : 'production';
    await query(
      `UPDATE website_configs
          SET deriv_client_id = $1, deriv_scopes = $2::jsonb, deriv_environment = $3,
              setup_step = GREATEST(setup_step, 5), configuration_status = 'in_progress', updated_at = NOW()
        WHERE website_id = $4`,
      [clientId, JSON.stringify(scopes), environment, request.params.websiteId],
    );
    return await respondBuilder(request, response);
  } catch (error) { return next(error); }
});

router.post('/:websiteId/complete', async (request, response, next) => {
  try {
    const row = await ensureOwnedBuilder(request.params.websiteId, request.authUser.id);
    if (!row) return response.status(404).json({ message: 'Website not found.' });
    const shaped = shapeBuilder(row);
    if (!shaped.readiness.configuration_ready) {
      return response.status(400).json({ message: 'The website configuration is incomplete.', missing: shaped.readiness.missing });
    }

    await transaction(async client => {
      await client.query(
        `UPDATE website_configs
            SET configuration_status = 'complete', setup_step = 5, completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
          WHERE website_id = $1`,
        [request.params.websiteId],
      );
      await client.query(
        `UPDATE websites
            SET status = CASE WHEN status IN ('draft', 'configuring') THEN 'ready' ELSE status END, updated_at = NOW()
          WHERE id = $1 AND owner_user_id = $2`,
        [request.params.websiteId, request.authUser.id],
      );
    });
    return await respondBuilder(request, response);
  } catch (error) { return next(error); }
});

export default router;
