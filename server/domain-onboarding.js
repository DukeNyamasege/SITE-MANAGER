import express from 'express';
import { resolveTxt } from 'node:dns/promises';
import { query } from './db.js';
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
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

function isValidHostname(hostname) {
  if (!hostname || hostname.length > 253 || hostname === 'localhost') return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const labels = hostname.split('.');
  if (labels.length < 2) return false;
  return labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

function purchaseUrl(hostname) {
  return `https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(hostname)}`;
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function xmlAttributes(fragment) {
  const result = {};
  for (const match of String(fragment || '').matchAll(/([A-Za-z0-9_:-]+)="([^"]*)"/g)) {
    result[match[1]] = decodeXml(match[2]);
  }
  return result;
}

function namecheapSettings() {
  const apiUser = String(process.env.NAMECHEAP_API_USER || '').trim();
  const apiKey = String(process.env.NAMECHEAP_API_KEY || '').trim();
  const username = String(process.env.NAMECHEAP_USERNAME || apiUser).trim();
  const clientIp = String(process.env.NAMECHEAP_CLIENT_IP || '').trim();
  const sandbox = String(process.env.NAMECHEAP_API_SANDBOX || 'false').toLowerCase() === 'true';
  return {
    enabled: Boolean(apiUser && apiKey && username && clientIp),
    apiUser,
    apiKey,
    username,
    clientIp,
    endpoint: sandbox ? 'https://api.sandbox.namecheap.com/xml.response' : 'https://api.namecheap.com/xml.response',
  };
}

async function checkWithNamecheap(hostname) {
  const settings = namecheapSettings();
  if (!settings.enabled) throw new Error('Namecheap API credentials are not configured.');
  const params = new URLSearchParams({
    ApiUser: settings.apiUser,
    ApiKey: settings.apiKey,
    UserName: settings.username,
    ClientIp: settings.clientIp,
    Command: 'namecheap.domains.check',
    DomainList: hostname,
  });
  const response = await fetch(`${settings.endpoint}?${params.toString()}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Namecheap availability request failed with HTTP ${response.status}.`);
  const xml = await response.text();
  const resultMatch = xml.match(/<DomainCheckResult\b([^>]*)\/?\s*>/i);
  if (!resultMatch) {
    const errorMatch = xml.match(/<Error\b[^>]*>([\s\S]*?)<\/Error>/i);
    throw new Error(errorMatch ? `Namecheap: ${decodeXml(errorMatch[1]).trim()}` : 'Namecheap did not return a domain result.');
  }
  const attrs = xmlAttributes(resultMatch[1]);
  const available = String(attrs.Available || '').toLowerCase() === 'true';
  const premium = String(attrs.IsPremiumName || '').toLowerCase() === 'true';
  const premiumRegistration = Number(attrs.PremiumRegistrationPrice || 0);
  const premiumRenewal = Number(attrs.PremiumRenewalPrice || 0);
  return {
    status: available ? 'available' : 'registered',
    source: 'namecheap',
    is_premium: premium,
    premium_registration_price: premium && Number.isFinite(premiumRegistration) ? premiumRegistration : null,
    premium_renewal_price: premium && Number.isFinite(premiumRenewal) ? premiumRenewal : null,
    price_currency: premium ? 'USD' : null,
    price_note: premium
      ? 'Premium pricing reported by Namecheap. Confirm the final checkout total before purchase.'
      : 'Standard domain. Namecheap shows the current registration and renewal price before payment.',
  };
}

async function checkWithRdap(hostname) {
  const response = await fetch(`https://rdap.org/domain/${encodeURIComponent(hostname)}`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/rdap+json, application/json' },
  });
  if (response.status === 404) {
    return {
      status: 'available',
      source: 'rdap',
      is_premium: null,
      premium_registration_price: null,
      premium_renewal_price: null,
      price_currency: null,
      price_note: 'Availability was checked through RDAP. Premium/checkout pricing must still be confirmed at the registrar before purchase.',
    };
  }
  if (response.ok) {
    return {
      status: 'registered',
      source: 'rdap',
      is_premium: null,
      premium_registration_price: null,
      premium_renewal_price: null,
      price_currency: null,
      price_note: 'This domain is already registered. If you own it, you can prove ownership and continue.',
    };
  }
  throw new Error(`RDAP availability request returned HTTP ${response.status}.`);
}

async function checkAvailability(hostname) {
  if (process.env.NODE_ENV === 'test' && process.env.DOMAIN_AVAILABILITY_MODE === 'stub') {
    const premium = hostname.endsWith('.premium.test');
    const registered = hostname.endsWith('.taken.test');
    return {
      status: registered ? 'registered' : 'available',
      source: 'test-stub',
      is_premium: premium,
      premium_registration_price: premium ? 12500 : null,
      premium_renewal_price: premium ? 12500 : null,
      price_currency: premium ? 'USD' : null,
      price_note: premium ? 'Test premium domain.' : 'Test standard domain.',
    };
  }

  const mode = String(process.env.DOMAIN_AVAILABILITY_MODE || 'auto').trim().toLowerCase();
  const namecheap = namecheapSettings();
  if (mode === 'namecheap' || (mode === 'auto' && namecheap.enabled)) return checkWithNamecheap(hostname);
  return checkWithRdap(hostname);
}

function providerHost(row) {
  return String(row.verification_record_name || '').replace(`.${row.hostname}`, '');
}

function shapeIntent(row) {
  return {
    id: row.id,
    hostname: row.hostname,
    registrar: row.registrar,
    status: row.status,
    availability_status: row.availability_status,
    availability_source: row.availability_source,
    is_premium: row.is_premium,
    premium_registration_price: row.premium_registration_price == null ? null : Number(row.premium_registration_price),
    premium_renewal_price: row.premium_renewal_price == null ? null : Number(row.premium_renewal_price),
    price_currency: row.price_currency,
    price_note: row.price_note,
    purchase_status: row.purchase_status,
    ownership_status: row.ownership_status,
    purchase_url: purchaseUrl(row.hostname),
    verification_record: row.purchase_status === 'confirmed' ? {
      type: 'TXT',
      name: row.verification_record_name,
      provider_host: providerHost(row),
      value: row.verification_record_value,
    } : null,
    checked_at: row.checked_at,
    purchase_confirmed_at: row.purchase_confirmed_at,
    ownership_verified_at: row.ownership_verified_at,
    last_ownership_check_at: row.last_ownership_check_at,
    claimed_website_id: row.claimed_website_id,
  };
}

async function ownedIntent(id, userId) {
  return (await query(
    'SELECT * FROM domain_onboarding_intents WHERE id = $1 AND user_id = $2 LIMIT 1',
    [id, userId],
  )).rows[0] || null;
}

router.get('/', async (request, response, next) => {
  try {
    const intents = (await query(
      `SELECT * FROM domain_onboarding_intents
        WHERE user_id = $1 AND status <> 'abandoned'
        ORDER BY created_at DESC LIMIT 20`,
      [request.authUser.id],
    )).rows;
    const websiteCount = Number((await query(
      `SELECT COUNT(*)::int AS count FROM websites
        WHERE owner_user_id = $1 AND status <> 'archived'`,
      [request.authUser.id],
    )).rows[0]?.count || 0);
    return response.json({
      intents: intents.map(shapeIntent),
      requires_domain_first: websiteCount === 0,
      namecheap_api_enabled: namecheapSettings().enabled,
    });
  } catch (error) { return next(error); }
});

router.post('/check', async (request, response, next) => {
  try {
    const hostname = normalizeHostname(request.body?.hostname);
    const registrar = request.body?.registrar === 'other' ? 'other' : 'namecheap';
    if (!isValidHostname(hostname)) return response.status(400).json({ message: 'Enter a valid domain such as duke.site.' });

    const attached = (await query('SELECT website_id FROM website_domains WHERE LOWER(hostname) = LOWER($1) LIMIT 1', [hostname])).rows[0];
    if (attached) return response.status(409).json({ message: 'That domain is already attached to a Site Manager website.' });

    const existing = (await query(
      'SELECT * FROM domain_onboarding_intents WHERE user_id = $1 AND LOWER(hostname) = LOWER($2) LIMIT 1',
      [request.authUser.id, hostname],
    )).rows[0];
    if (existing?.claimed_website_id) return response.status(409).json({ message: 'That verified domain has already been used to create a website.' });
    if (existing?.ownership_status === 'verified') return response.json({ intent: shapeIntent(existing) });

    let availability;
    try {
      availability = await checkAvailability(hostname);
    } catch (error) {
      availability = {
        status: 'unknown', source: 'unavailable', is_premium: null,
        premium_registration_price: null, premium_renewal_price: null, price_currency: null,
        price_note: `Automatic availability check could not complete: ${String(error?.message || error)} Check the live registrar result before purchasing.`,
      };
    }

    const token = existing?.verification_token || randomToken(24);
    const recordName = `_site-manager-verify.${hostname}`;
    const recordValue = existing?.verification_record_value || `site-manager-verification=${token}`;
    const result = await query(
      `INSERT INTO domain_onboarding_intents
         (user_id, hostname, registrar, status, availability_status, availability_source,
          is_premium, premium_registration_price, premium_renewal_price, price_currency,
          price_note, verification_token, verification_record_name, verification_record_value, checked_at)
       VALUES ($1,$2,$3,'searched',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       ON CONFLICT (user_id, hostname) DO UPDATE SET
         registrar = EXCLUDED.registrar,
         availability_status = EXCLUDED.availability_status,
         availability_source = EXCLUDED.availability_source,
         is_premium = EXCLUDED.is_premium,
         premium_registration_price = EXCLUDED.premium_registration_price,
         premium_renewal_price = EXCLUDED.premium_renewal_price,
         price_currency = EXCLUDED.price_currency,
         price_note = EXCLUDED.price_note,
         checked_at = NOW(), updated_at = NOW()
       RETURNING *`,
      [request.authUser.id, hostname, registrar, availability.status, availability.source,
        availability.is_premium, availability.premium_registration_price,
        availability.premium_renewal_price, availability.price_currency, availability.price_note,
        token, recordName, recordValue],
    );
    return response.json({ intent: shapeIntent(result.rows[0]) });
  } catch (error) { return next(error); }
});

router.post('/:intentId/purchase-confirmed', async (request, response, next) => {
  try {
    const intent = await ownedIntent(request.params.intentId, request.authUser.id);
    if (!intent) return response.status(404).json({ message: 'Domain selection not found.' });
    if (intent.claimed_website_id) return response.status(409).json({ message: 'This domain has already been used for a website.' });
    const alreadyOwned = request.body?.already_owned === true;
    if (intent.availability_status !== 'available' && !alreadyOwned) {
      return response.status(409).json({
        message: intent.availability_status === 'registered'
          ? 'This domain is already registered. Continue only if you already own it.'
          : 'Availability is not confirmed. Check the registrar first, or continue only if you already own the domain.',
      });
    }
    const updated = (await query(
      `UPDATE domain_onboarding_intents
          SET purchase_status = 'confirmed', status = CASE WHEN ownership_status = 'verified' THEN 'verified' ELSE 'purchase_confirmed' END,
              purchase_confirmed_at = COALESCE(purchase_confirmed_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND user_id = $2 RETURNING *`,
      [intent.id, request.authUser.id],
    )).rows[0];
    return response.json({ intent: shapeIntent(updated) });
  } catch (error) { return next(error); }
});

router.post('/:intentId/check-ownership', async (request, response, next) => {
  try {
    const intent = await ownedIntent(request.params.intentId, request.authUser.id);
    if (!intent) return response.status(404).json({ message: 'Domain selection not found.' });
    if (intent.purchase_status !== 'confirmed') return response.status(409).json({ message: 'Confirm that you purchased or already own the domain first.' });
    if (intent.claimed_website_id) return response.status(409).json({ message: 'This domain has already been used for a website.' });

    const attached = (await query('SELECT website_id FROM website_domains WHERE LOWER(hostname) = LOWER($1) LIMIT 1', [intent.hostname])).rows[0];
    if (attached) return response.status(409).json({ message: 'That domain is already attached to another Site Manager website.' });

    let values = [];
    let verified = false;
    if (process.env.NODE_ENV === 'test' && process.env.DOMAIN_OWNERSHIP_TEST_MODE === 'verified') {
      values = [intent.verification_record_value];
      verified = true;
    } else {
      try {
        values = (await resolveTxt(intent.verification_record_name)).map(parts => parts.join(''));
        verified = values.includes(intent.verification_record_value);
      } catch {
        values = [];
      }
    }

    try {
      const updated = (await query(
        `UPDATE domain_onboarding_intents
            SET ownership_status = CASE WHEN $1 THEN 'verified' ELSE 'pending' END,
                status = CASE WHEN $1 THEN 'verified' ELSE 'purchase_confirmed' END,
                ownership_verified_at = CASE WHEN $1 THEN COALESCE(ownership_verified_at, NOW()) ELSE ownership_verified_at END,
                last_ownership_check_at = NOW(), updated_at = NOW()
          WHERE id = $2 AND user_id = $3 RETURNING *`,
        [verified, intent.id, request.authUser.id],
      )).rows[0];
      return response.json({
        verified,
        observed_txt: values,
        message: verified ? 'Domain ownership verified. Website creation is now unlocked.' : 'The verification TXT record is not visible yet.',
        intent: shapeIntent(updated),
      });
    } catch (error) {
      if (error?.code === '23505') return response.status(409).json({ message: 'This domain is already verified by another Site Manager account.' });
      throw error;
    }
  } catch (error) { return next(error); }
});

export default router;
