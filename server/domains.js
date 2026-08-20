import express from 'express';
import { resolve4, resolve6, resolveCname, resolveTxt } from 'node:dns/promises';
import { query, transaction } from './db.js';
import { randomToken } from './security.js';
import { requireAuthenticatedUser } from './session.js';

const router = express.Router();
router.use(requireAuthenticatedUser);

function normalizeHostname(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
}

function isValidHostname(hostname) {
  if (!hostname || hostname.length > 253 || hostname === 'localhost') return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const labels = hostname.split('.');
  if (labels.length < 2) return false;
  return labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

function platformBaseDomain() {
  const value = normalizeHostname(process.env.PLATFORM_SITE_BASE_DOMAIN || 'sites.localhost');
  return value || 'sites.localhost';
}

function expectedRouting() {
  return {
    ipv4: String(process.env.VPS_PUBLIC_IPV4 || '').split(',').map(item => item.trim()).filter(Boolean),
    ipv6: String(process.env.VPS_PUBLIC_IPV6 || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean),
    cname: normalizeHostname(process.env.VPS_CNAME_TARGET || ''),
  };
}

async function safeResolve(resolver, hostname) {
  try { return await resolver(hostname); } catch { return []; }
}

async function checkRouting(hostname) {
  const expected = expectedRouting();
  if (!expected.ipv4.length && !expected.ipv6.length && !expected.cname) {
    return {
      ready: false,
      observed: { a: [], aaaa: [], cname: [] },
      message: 'The VPS public routing target has not been configured in Site Manager yet.',
    };
  }

  const [a, aaaa, cnameAnswers] = await Promise.all([
    safeResolve(resolve4, hostname),
    safeResolve(resolve6, hostname),
    safeResolve(resolveCname, hostname),
  ]);
  const cname = cnameAnswers.map(normalizeHostname);
  const ready = expected.ipv4.some(address => a.includes(address))
    || expected.ipv6.some(address => aaaa.map(item => item.toLowerCase()).includes(address))
    || (expected.cname && cname.includes(expected.cname));
  return {
    ready: Boolean(ready),
    observed: { a, aaaa, cname },
    message: ready
      ? 'DNS routing reaches the configured Site Manager VPS target.'
      : 'Ownership may be verified, but this hostname does not yet resolve to the configured VPS target.',
  };
}

async function ownedWebsite(websiteId, userId) {
  const result = await query(
    `SELECT w.id, w.site_key, w.name, w.status, w.preview_approved_at,
            w.primary_domain, w.domain_status, w.deployment_status,
            c.configuration_status, c.deriv_client_id, c.deriv_environment
       FROM websites w
       JOIN website_configs c ON c.website_id = w.id
      WHERE w.id = $1 AND w.owner_user_id = $2 AND w.status <> 'archived'
      LIMIT 1`,
    [websiteId, userId],
  );
  return result.rows[0] || null;
}

async function ownedDomain(websiteId, domainId, userId) {
  const result = await query(
    `SELECT d.*
       FROM website_domains d
       JOIN websites w ON w.id = d.website_id
      WHERE d.id = $1 AND d.website_id = $2 AND w.owner_user_id = $3 AND w.status <> 'archived'
      LIMIT 1`,
    [domainId, websiteId, userId],
  );
  return result.rows[0] || null;
}

function shapeDomain(row) {
  return {
    id: row.id,
    hostname: row.hostname,
    kind: row.kind,
    is_primary: row.is_primary,
    ownership_status: row.ownership_status,
    routing_status: row.routing_status,
    ssl_status: row.ssl_status,
    verification_record: row.kind === 'custom' ? {
      type: 'TXT',
      name: row.verification_record_name,
      value: row.verification_record_value,
    } : null,
    last_checked_at: row.last_checked_at,
    ownership_verified_at: row.ownership_verified_at,
    routing_verified_at: row.routing_verified_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listDomains(websiteId, userId) {
  const result = await query(
    `SELECT d.* FROM website_domains d
      JOIN websites w ON w.id = d.website_id
     WHERE d.website_id = $1 AND w.owner_user_id = $2
     ORDER BY d.is_primary DESC, d.created_at ASC`,
    [websiteId, userId],
  );
  return result.rows;
}

async function deploymentReadiness(websiteId, userId) {
  const website = await ownedWebsite(websiteId, userId);
  if (!website) return null;
  const domains = await listDomains(websiteId, userId);
  const primary = domains.find(item => item.is_primary) || null;
  const hostname = primary?.hostname || '';
  const checks = {
    configuration_complete: website.configuration_status === 'complete',
    preview_approved: Boolean(website.preview_approved_at),
    hostname_selected: Boolean(primary),
    ownership_verified: Boolean(primary && ['verified', 'not_required'].includes(primary.ownership_status)),
    routing_ready: primary?.routing_status === 'ready',
    ssl_eligible: Boolean(primary && ['eligible', 'provisioned'].includes(primary.ssl_status)),
    deriv_client_configured: Boolean(String(website.deriv_client_id || '').trim()),
  };
  return {
    website: {
      id: website.id,
      name: website.name,
      site_key: website.site_key,
      status: website.status,
      preview_approved_at: website.preview_approved_at,
      deployment_status: website.deployment_status,
    },
    primary_domain: primary ? shapeDomain(primary) : null,
    callback_url: hostname ? `https://${hostname}/callback` : '',
    deriv_environment: website.deriv_environment === 'staging' ? 'staging' : 'production',
    checks,
    deployment_ready: Object.values(checks).every(Boolean),
    billing_required: false,
    billing_note: 'Payment activation is intentionally deferred until the full website lifecycle is complete.',
  };
}

async function syncWebsiteDomainState(client, websiteId, domain) {
  const connected = domain && ['verified', 'not_required'].includes(domain.ownership_status) && domain.routing_status === 'ready';
  await client.query(
    `UPDATE websites
        SET primary_domain = $1,
            domain_status = $2,
            updated_at = NOW()
      WHERE id = $3`,
    [domain?.hostname || null, domain ? (connected ? 'connected' : 'pending') : 'none', websiteId],
  );
}

router.get('/:websiteId', async (request, response, next) => {
  try {
    const website = await ownedWebsite(request.params.websiteId, request.authUser.id);
    if (!website) return response.status(404).json({ message: 'Website not found.' });
    const domains = await listDomains(website.id, request.authUser.id);
    const readiness = await deploymentReadiness(website.id, request.authUser.id);
    return response.json({
      domains: domains.map(shapeDomain),
      platform_base_domain: platformBaseDomain(),
      routing_target: expectedRouting(),
      readiness,
    });
  } catch (error) { return next(error); }
});

router.post('/:websiteId/platform', async (request, response, next) => {
  try {
    const website = await ownedWebsite(request.params.websiteId, request.authUser.id);
    if (!website) return response.status(404).json({ message: 'Website not found.' });
    const hostname = `${website.site_key}.${platformBaseDomain()}`;
    const routing = await checkRouting(hostname);

    await transaction(async client => {
      const existing = await client.query('SELECT id FROM website_domains WHERE website_id = $1 AND kind = \'platform\' LIMIT 1', [website.id]);
      if (!existing.rows[0]) {
        const hasPrimary = await client.query('SELECT id FROM website_domains WHERE website_id = $1 AND is_primary = TRUE LIMIT 1', [website.id]);
        await client.query(
          `INSERT INTO website_domains
             (website_id, hostname, kind, is_primary, ownership_status, routing_status, ssl_status, last_checked_at, routing_verified_at)
           VALUES ($1, $2, 'platform', $3, 'not_required', $4, $5, NOW(), $6)`,
          [website.id, hostname, !hasPrimary.rows[0], routing.ready ? 'ready' : 'pending', routing.ready ? 'eligible' : 'pending', routing.ready ? new Date() : null],
        );
      } else {
        await client.query(
          `UPDATE website_domains
              SET routing_status = $1, ssl_status = $2, last_checked_at = NOW(),
                  routing_verified_at = CASE WHEN $1 = 'ready' THEN COALESCE(routing_verified_at, NOW()) ELSE routing_verified_at END,
                  updated_at = NOW()
            WHERE id = $3`,
          [routing.ready ? 'ready' : 'pending', routing.ready ? 'eligible' : 'pending', existing.rows[0].id],
        );
      }
      const primaryResult = await client.query('SELECT * FROM website_domains WHERE website_id = $1 AND is_primary = TRUE LIMIT 1', [website.id]);
      await syncWebsiteDomainState(client, website.id, primaryResult.rows[0] || null);
    });

    const domains = await listDomains(website.id, request.authUser.id);
    return response.status(201).json({ domains: domains.map(shapeDomain), routing, readiness: await deploymentReadiness(website.id, request.authUser.id) });
  } catch (error) {
    if (error?.code === '23505') return response.status(409).json({ message: 'That platform address is already reserved.' });
    return next(error);
  }
});

router.post('/:websiteId/custom', async (request, response, next) => {
  try {
    const website = await ownedWebsite(request.params.websiteId, request.authUser.id);
    if (!website) return response.status(404).json({ message: 'Website not found.' });
    const hostname = normalizeHostname(request.body?.hostname);
    if (!isValidHostname(hostname)) return response.status(400).json({ message: 'Enter a valid public domain or subdomain.' });
    if (hostname === platformBaseDomain() || hostname.endsWith(`.${platformBaseDomain()}`)) {
      return response.status(400).json({ message: 'Platform addresses are reserved by Site Manager.' });
    }

    const token = randomToken(24);
    const recordName = `_site-manager-verify.${hostname}`;
    const recordValue = `site-manager-verification=${token}`;
    const result = await transaction(async client => {
      const hasPrimary = await client.query('SELECT id FROM website_domains WHERE website_id = $1 AND is_primary = TRUE LIMIT 1', [website.id]);
      return client.query(
        `INSERT INTO website_domains
           (website_id, hostname, kind, is_primary, ownership_status, routing_status, ssl_status,
            verification_token, verification_record_name, verification_record_value)
         VALUES ($1, $2, 'custom', $3, 'pending', 'pending', 'pending', $4, $5, $6)
         RETURNING *`,
        [website.id, hostname, !hasPrimary.rows[0], token, recordName, recordValue],
      );
    });
    return response.status(201).json({ domain: shapeDomain(result.rows[0]), readiness: await deploymentReadiness(website.id, request.authUser.id) });
  } catch (error) {
    if (error?.code === '23505') return response.status(409).json({ message: 'That hostname is already attached to a Site Manager website.' });
    return next(error);
  }
});

router.post('/:websiteId/:domainId/check', async (request, response, next) => {
  try {
    const domain = await ownedDomain(request.params.websiteId, request.params.domainId, request.authUser.id);
    if (!domain) return response.status(404).json({ message: 'Domain not found.' });

    let ownershipVerified = domain.kind === 'platform';
    let ownershipMessage = domain.kind === 'platform' ? 'Platform addresses do not require customer ownership verification.' : '';
    let txtValues = [];
    if (domain.kind === 'custom') {
      txtValues = (await safeResolve(resolveTxt, domain.verification_record_name)).map(parts => parts.join(''));
      ownershipVerified = txtValues.includes(domain.verification_record_value);
      ownershipMessage = ownershipVerified
        ? 'Domain ownership TXT record verified.'
        : 'The expected ownership TXT record is not visible yet.';
    }

    const routing = await checkRouting(domain.hostname);
    const ownershipStatus = domain.kind === 'platform' ? 'not_required' : ownershipVerified ? 'verified' : 'pending';
    const sslStatus = ownershipVerified && routing.ready ? 'eligible' : 'pending';

    await transaction(async client => {
      await client.query(
        `UPDATE website_domains
            SET ownership_status = $1,
                routing_status = $2,
                ssl_status = $3,
                last_checked_at = NOW(),
                ownership_verified_at = CASE WHEN $4 THEN COALESCE(ownership_verified_at, NOW()) ELSE ownership_verified_at END,
                routing_verified_at = CASE WHEN $2 = 'ready' THEN COALESCE(routing_verified_at, NOW()) ELSE routing_verified_at END,
                updated_at = NOW()
          WHERE id = $5`,
        [ownershipStatus, routing.ready ? 'ready' : 'pending', sslStatus, ownershipVerified, domain.id],
      );
      const refreshed = await client.query('SELECT * FROM website_domains WHERE id = $1', [domain.id]);
      if (refreshed.rows[0].is_primary) await syncWebsiteDomainState(client, request.params.websiteId, refreshed.rows[0]);
    });

    return response.json({
      ownership: { verified: ownershipVerified, message: ownershipMessage, observed_txt: txtValues },
      routing,
      domain: shapeDomain(await ownedDomain(request.params.websiteId, request.params.domainId, request.authUser.id)),
      readiness: await deploymentReadiness(request.params.websiteId, request.authUser.id),
    });
  } catch (error) { return next(error); }
});

router.post('/:websiteId/:domainId/primary', async (request, response, next) => {
  try {
    const domain = await ownedDomain(request.params.websiteId, request.params.domainId, request.authUser.id);
    if (!domain) return response.status(404).json({ message: 'Domain not found.' });
    if (!['verified', 'not_required'].includes(domain.ownership_status)) {
      return response.status(400).json({ message: 'Verify ownership before making this the primary hostname.' });
    }

    await transaction(async client => {
      await client.query('UPDATE website_domains SET is_primary = FALSE, updated_at = NOW() WHERE website_id = $1', [request.params.websiteId]);
      await client.query('UPDATE website_domains SET is_primary = TRUE, updated_at = NOW() WHERE id = $1', [domain.id]);
      const selected = await client.query('SELECT * FROM website_domains WHERE id = $1', [domain.id]);
      await syncWebsiteDomainState(client, request.params.websiteId, selected.rows[0]);
    });
    return response.json({ domains: (await listDomains(request.params.websiteId, request.authUser.id)).map(shapeDomain), readiness: await deploymentReadiness(request.params.websiteId, request.authUser.id) });
  } catch (error) { return next(error); }
});

router.post('/:websiteId/approve-preview', async (request, response, next) => {
  try {
    const website = await ownedWebsite(request.params.websiteId, request.authUser.id);
    if (!website) return response.status(404).json({ message: 'Website not found.' });
    if (website.configuration_status !== 'complete') {
      return response.status(400).json({ message: 'Complete the website configuration before approving its preview.' });
    }
    await query(
      `UPDATE websites SET preview_approved_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND owner_user_id = $2`,
      [website.id, request.authUser.id],
    );
    return response.json({ ok: true, readiness: await deploymentReadiness(website.id, request.authUser.id) });
  } catch (error) { return next(error); }
});

router.get('/:websiteId/readiness/status', async (request, response, next) => {
  try {
    const readiness = await deploymentReadiness(request.params.websiteId, request.authUser.id);
    if (!readiness) return response.status(404).json({ message: 'Website not found.' });
    return response.json({ readiness });
  } catch (error) { return next(error); }
});

export default router;
