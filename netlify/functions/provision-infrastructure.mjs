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

const callDnsProvisioner = async payload => {
  const url = String(process.env.PROVISIONER_URL || '').replace(/\/$/, '');
  const secret = process.env.PROVISIONER_SECRET;
  if (!url || !secret) return { configured: false, status: 'manual' };

  const response = await fetch(`${url}/provision-namecheap`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = { message: text }; }
  }
  if (!response.ok) {
    return {
      configured: true,
      status: 'failed',
      message: body?.message || `DNS provisioner failed (${response.status}).`,
    };
  }
  return { configured: true, status: 'configured', ...body };
};

export const handler = async event => {
  try {
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'Method not allowed.');
    const site = await requireSiteAccess(event);
    const domain = normalizeHost(site.display_domain || site.website_url);
    if (!domain) throw new HttpError(400, 'The managed site has no valid domain.');

    const netlifySiteId = process.env.NETLIFY_SITE_ID;
    if (!process.env.NETLIFY_ACCESS_TOKEN || !netlifySiteId) {
      return json(200, {
        status: 'needs_configuration',
        message: 'GitHub provisioning is complete. Configure NETLIFY_ACCESS_TOKEN and NETLIFY_SITE_ID to automate domain aliases.',
        domain,
        dns: {
          apex: { type: 'ALIAS', host: '@', value: 'apex-loadbalancer.netlify.com' },
          apex_fallback: { type: 'A', host: '@', value: '75.2.60.5' },
          www: { type: 'CNAME', host: 'www', value: process.env.NETLIFY_SITE_HOSTNAME || '' },
        },
      });
    }

    const currentSite = await netlifyRequest(`sites/${encodeURIComponent(netlifySiteId)}`);
    const defaultHostname = normalizeHost(process.env.NETLIFY_SITE_HOSTNAME || currentSite?.url || currentSite?.ssl_url || '');
    if (!defaultHostname.endsWith('.netlify.app')) {
      throw new HttpError(500, 'Could not determine the target .netlify.app hostname. Set NETLIFY_SITE_HOSTNAME.');
    }

    const existingAliases = Array.isArray(currentSite?.domain_aliases) ? currentSite.domain_aliases.map(normalizeHost).filter(Boolean) : [];
    const aliases = Array.from(new Set([...existingAliases, domain, `www.${domain}`]));
    await netlifyRequest(`sites/${encodeURIComponent(netlifySiteId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain_aliases: aliases }),
    });

    const dns = await callDnsProvisioner({
      domain,
      netlify_hostname: defaultHostname,
      apex_alias: 'apex-loadbalancer.netlify.com',
      apex_fallback_ip: '75.2.60.5',
    });

    let ssl = { status: 'waiting_for_dns' };
    if (dns.status === 'configured') {
      try {
        await netlifyRequest(`sites/${encodeURIComponent(netlifySiteId)}/ssl`, { method: 'POST' });
        ssl = { status: 'requested' };
      } catch (error) {
        ssl = { status: 'pending', message: error instanceof Error ? error.message : String(error) };
      }
    }

    return json(200, {
      status: dns.status === 'configured' ? 'domain_connected' : 'dns_required',
      message: dns.status === 'configured'
        ? 'Netlify aliases and DNS were configured. SSL provisioning has been requested.'
        : 'Netlify aliases were added. Complete the DNS records shown below, or connect the fixed-IP DNS provisioner.',
      domain,
      netlify: {
        site_id: netlifySiteId,
        hostname: defaultHostname,
        aliases_added: [domain, `www.${domain}`],
      },
      dns,
      dns_records: {
        apex: { type: 'ALIAS', host: '@', value: 'apex-loadbalancer.netlify.com' },
        apex_fallback: { type: 'A', host: '@', value: '75.2.60.5' },
        www: { type: 'CNAME', host: 'www', value: defaultHostname },
      },
      ssl,
    });
  } catch (error) {
    return errorResponse(error);
  }
};
