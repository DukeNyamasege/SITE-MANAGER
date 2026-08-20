import express from 'express';
import { query, transaction } from './db.js';
import { randomToken } from './security.js';
import { requireAuthenticatedUser } from './session.js';

const router = express.Router();
router.use(requireAuthenticatedUser);

function safeWebsiteName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 100);
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'site';
}

function siteKeyFor(name) {
  return `${slugify(name)}-${randomToken(4).replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 6)}`;
}

function shapeWebsite(row) {
  return {
    id: row.id,
    name: row.name,
    site_key: row.site_key,
    template_id: row.template_id,
    source: row.source,
    status: row.status,
    primary_domain: row.primary_domain,
    domain_status: row.domain_status,
    deployment_status: row.deployment_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    subscription: {
      id: row.subscription_id,
      price_cents: Number(row.price_cents ?? 1000),
      currency: row.currency || 'USD',
      billing_status: row.billing_status || 'not_started',
      trial_started_at: row.trial_started_at,
      trial_ends_at: row.trial_ends_at,
      current_period_started_at: row.current_period_started_at,
      current_period_ends_at: row.current_period_ends_at,
    },
  };
}

const selectWebsite = `
  SELECT w.id, w.name, w.site_key, w.template_id, w.source, w.status,
         w.primary_domain, w.domain_status, w.deployment_status,
         w.created_at, w.updated_at,
         s.id AS subscription_id, s.price_cents, s.currency, s.billing_status,
         s.trial_started_at, s.trial_ends_at,
         s.current_period_started_at, s.current_period_ends_at
    FROM websites w
    JOIN website_subscriptions s ON s.website_id = w.id
`;

router.get('/', async (request, response, next) => {
  try {
    const result = await query(
      `${selectWebsite}
        WHERE w.owner_user_id = $1
          AND w.status <> 'archived'
        ORDER BY w.created_at DESC`,
      [request.authUser.id],
    );
    return response.json({ websites: result.rows.map(shapeWebsite) });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (request, response, next) => {
  try {
    const name = safeWebsiteName(request.body?.name);
    const domainOnboardingId = String(request.body?.domain_onboarding_id || '').trim();
    if (name.length < 2) return response.status(400).json({ message: 'Website name must be at least 2 characters.' });
    if (!domainOnboardingId) {
      return response.status(409).json({
        message: 'Choose, purchase and verify your domain before creating the website.',
        code: 'domain_first_required',
      });
    }

    const duplicate = await query(
      `SELECT id FROM websites
        WHERE owner_user_id = $1
          AND LOWER(name) = LOWER($2)
          AND status <> 'archived'
        LIMIT 1`,
      [request.authUser.id, name],
    );
    if (duplicate.rows[0]) return response.status(409).json({ message: 'You already have a website with this name.' });

    const created = await transaction(async client => {
      const onboarding = (await client.query(
        `SELECT * FROM domain_onboarding_intents
          WHERE id = $1 AND user_id = $2
          FOR UPDATE`,
        [domainOnboardingId, request.authUser.id],
      )).rows[0];
      if (!onboarding) {
        const error = new Error('Domain onboarding record not found. Search and verify the domain first.');
        error.status = 409;
        throw error;
      }
      if (onboarding.claimed_website_id || onboarding.status === 'claimed') {
        const error = new Error('This verified domain has already been used to create a website.');
        error.status = 409;
        throw error;
      }
      if (onboarding.purchase_status !== 'confirmed' || onboarding.ownership_status !== 'verified' || onboarding.status !== 'verified') {
        const error = new Error('Domain purchase/ownership must be confirmed before website creation.');
        error.status = 409;
        throw error;
      }

      const existingDomain = (await client.query(
        'SELECT website_id FROM website_domains WHERE LOWER(hostname) = LOWER($1) LIMIT 1',
        [onboarding.hostname],
      )).rows[0];
      if (existingDomain) {
        const error = new Error('That domain is already attached to another Site Manager website.');
        error.status = 409;
        throw error;
      }

      let website;
      for (let attempt = 0; attempt < 4 && !website; attempt += 1) {
        const siteKey = siteKeyFor(name);
        try {
          const result = await client.query(
            `INSERT INTO websites (owner_user_id, name, site_key, template_id, primary_domain, domain_status)
             VALUES ($1, $2, $3, 'nnn', $4, 'pending')
             RETURNING id`,
            [request.authUser.id, name, siteKey, onboarding.hostname],
          );
          website = result.rows[0];
        } catch (error) {
          if (error?.code !== '23505') throw error;
        }
      }
      if (!website) throw new Error('Could not allocate a unique website key.');

      await client.query(
        `INSERT INTO website_subscriptions (website_id, price_cents, currency, billing_status)
         VALUES ($1, 1000, 'USD', 'not_started')`,
        [website.id],
      );

      await client.query(
        `INSERT INTO website_domains
           (website_id, hostname, kind, is_primary, ownership_status, routing_status, ssl_status,
            verification_token, verification_record_name, verification_record_value,
            last_checked_at, ownership_verified_at)
         VALUES ($1,$2,'custom',TRUE,'verified','pending','pending',$3,$4,$5,NOW(),$6)`,
        [website.id, onboarding.hostname, onboarding.verification_token,
          onboarding.verification_record_name, onboarding.verification_record_value,
          onboarding.ownership_verified_at || new Date()],
      );

      await client.query(
        `UPDATE domain_onboarding_intents
            SET status = 'claimed', claimed_website_id = $1, updated_at = NOW()
          WHERE id = $2`,
        [website.id, onboarding.id],
      );

      const result = await client.query(`${selectWebsite} WHERE w.id = $1 AND w.owner_user_id = $2`, [website.id, request.authUser.id]);
      return result.rows[0];
    });

    return response.status(201).json({ website: shapeWebsite(created) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:websiteId', async (request, response, next) => {
  try {
    const result = await query(
      `${selectWebsite} WHERE w.id = $1 AND w.owner_user_id = $2 AND w.status <> 'archived' LIMIT 1`,
      [request.params.websiteId, request.authUser.id],
    );
    if (!result.rows[0]) return response.status(404).json({ message: 'Website not found.' });
    return response.json({ website: shapeWebsite(result.rows[0]) });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:websiteId', async (request, response, next) => {
  try {
    const name = safeWebsiteName(request.body?.name);
    if (name.length < 2) return response.status(400).json({ message: 'Website name must be at least 2 characters.' });

    const duplicate = await query(
      `SELECT id FROM websites
        WHERE owner_user_id = $1
          AND LOWER(name) = LOWER($2)
          AND id <> $3
          AND status <> 'archived'
        LIMIT 1`,
      [request.authUser.id, name, request.params.websiteId],
    );
    if (duplicate.rows[0]) return response.status(409).json({ message: 'You already have a website with this name.' });

    const updated = await query(
      `UPDATE websites
          SET name = $1, updated_at = NOW()
        WHERE id = $2 AND owner_user_id = $3 AND status <> 'archived'
        RETURNING id`,
      [name, request.params.websiteId, request.authUser.id],
    );
    if (!updated.rows[0]) return response.status(404).json({ message: 'Website not found.' });

    const result = await query(`${selectWebsite} WHERE w.id = $1 AND w.owner_user_id = $2 LIMIT 1`, [request.params.websiteId, request.authUser.id]);
    return response.json({ website: shapeWebsite(result.rows[0]) });
  } catch (error) {
    return next(error);
  }
});

router.post('/:websiteId/archive', async (request, response, next) => {
  try {
    const result = await query(
      `UPDATE websites
          SET status = 'archived', updated_at = NOW()
        WHERE id = $1 AND owner_user_id = $2 AND status <> 'archived'
        RETURNING id`,
      [request.params.websiteId, request.authUser.id],
    );
    if (!result.rows[0]) return response.status(404).json({ message: 'Website not found.' });
    return response.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

export default router;
