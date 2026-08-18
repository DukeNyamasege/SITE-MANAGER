import { HttpError, errorResponse, json, requireSiteAccess } from './_lib.mjs';

const normalizeHost = value => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/^https?:\/\//, '')
  .split('/')[0]
  .replace(/\.$/, '');

const netlifyRequest = async (path, options = {}) => {
  const token = process.env.NETLIFY_ACCESS_TOKEN;
  if (!token) throw new HttpError(503, 'NETLIFY_ACCESS_TOKEN is not configured.');
  const response = await fetch(`https://api.netlify.com/api/v1/${path.replace(/^\//, '')}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object'
      ? payload.message || payload.error || `Netlify request failed (${response.status}).`
      : `Netlify request failed (${response.status}).`;
    throw new HttpError(response.status, String(message), payload);
  }
  return payload;
};

const dnsRecords = hostname => ({
  apex: { type: 'ALIAS', host: '@', value: 'apex-loadbalancer.netlify.com' },
  apex_fallback: { type: 'A', host: '@', value: '75.2.60.5' },
  www: { type: 'CNAME', host: 'www', value: hostname },
});

const certificateCovers = (certificate, domain) => {
  const domains = Array.isArray(certificate?.domains)
    ? certificate.domains.map(normalizeHost).filter(Boolean)
    : [];
  return domains.includes(domain) && domains.includes(`www.${domain}`);
};

export const handler = async event => {
  try {
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'Method not allowed.');
    const site = await requireSiteAccess(event);
    const domain = normalizeHost(site.display_domain || site.website_url);
    if (!domain) throw new HttpError(400, 'The managed site has no valid domain.');

    const netlifySiteId = process.env.NETLIFY_SITE_ID;
    if (!process.env.NETLIFY_ACCESS_TOKEN || !netlifySiteId) {
      const hostname = normalizeHost(process.env.NETLIFY_SITE_HOSTNAME || '');
      return json(200, {
        status: 'needs_configuration',
        message: 'The source site is configured, but Netlify API access is not ready. Add NETLIFY_ACCESS_TOKEN and NETLIFY_SITE_ID to SITE-MANAGER.',
        domain,
        dns: { configured: false, status: 'manual', message: 'DNS is intentionally manual.' },
        dns_records: dnsRecords(hostname),
      });
    }

    const currentSite = await netlifyRequest(`sites/${encodeURIComponent(netlifySiteId)}`);
    const defaultHostname = normalizeHost(process.env.NETLIFY_SITE_HOSTNAME || currentSite?.url || currentSite?.ssl_url || '');
    if (!defaultHostname.endsWith('.netlify.app')) {
      throw new HttpError(500, 'Could not determine the target .netlify.app hostname. Set NETLIFY_SITE_HOSTNAME.');
    }

    const existingAliases = Array.isArray(currentSite?.domain_aliases)
      ? currentSite.domain_aliases.map(normalizeHost).filter(Boolean)
      : [];
    const aliases = Array.from(new Set([...existingAliases, domain, `www.${domain}`]));

    await netlifyRequest(`sites/${encodeURIComponent(netlifySiteId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain_aliases: aliases }),
    });

    let certificate = null;
    try {
      certificate = await netlifyRequest(`sites/${encodeURIComponent(netlifySiteId)}/ssl`);
    } catch (error) {
      if (!(error instanceof HttpError) || ![404, 422].includes(error.status)) throw error;
    }

    if (certificateCovers(certificate, domain)) {
      return json(200, {
        status: 'domain_connected',
        message: 'Netlify recognizes the domain aliases and the current TLS certificate covers the domain.',
        domain,
        netlify: {
          site_id: netlifySiteId,
          hostname: defaultHostname,
          aliases_added: [domain, `www.${domain}`],
        },
        dns: { configured: false, status: 'manual', message: 'DNS remains managed manually at your DNS provider.' },
        dns_records: dnsRecords(defaultHostname),
        ssl: { status: String(certificate?.state || 'ready') },
      });
    }

    let ssl = { status: 'waiting_for_dns' };
    try {
      const provisioned = await netlifyRequest(`sites/${encodeURIComponent(netlifySiteId)}/ssl`, { method: 'POST' });
      ssl = { status: String(provisioned?.state || 'requested') };
      return json(200, {
        status: 'domain_connected',
        message: 'Netlify accepted the domain aliases and TLS provisioning request. Keep the manual DNS records in place while the certificate becomes active.',
        domain,
        netlify: {
          site_id: netlifySiteId,
          hostname: defaultHostname,
          aliases_added: [domain, `www.${domain}`],
        },
        dns: { configured: false, status: 'manual', message: 'DNS remains managed manually at your DNS provider.' },
        dns_records: dnsRecords(defaultHostname),
        ssl,
      });
    } catch (error) {
      ssl = {
        status: 'waiting_for_dns',
        message: error instanceof Error ? error.message : String(error),
      };
    }

    return json(200, {
      status: 'dns_required',
      message: 'Netlify aliases are ready. Add the DNS records below manually, wait for propagation, then press Check DNS & SSL again.',
      domain,
      netlify: {
        site_id: netlifySiteId,
        hostname: defaultHostname,
        aliases_added: [domain, `www.${domain}`],
      },
      dns: {
        configured: false,
        status: 'manual',
        message: 'SITE-MANAGER will not change registrar DNS records. Configure them manually.',
      },
      dns_records: dnsRecords(defaultHostname),
      ssl,
    });
  } catch (error) {
    return errorResponse(error);
  }
};
