import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.PROVISIONER_SECRET || '';
const API_USER = process.env.NAMECHEAP_API_USER || '';
const API_KEY = process.env.NAMECHEAP_API_KEY || '';
const USERNAME = process.env.NAMECHEAP_USERNAME || API_USER;
const CLIENT_IP = process.env.NAMECHEAP_CLIENT_IP || '';
const API_BASE = process.env.NAMECHEAP_API_BASE || 'https://api.namecheap.com/xml.response';

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const normalizeDomain = value => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/^https?:\/\//, '')
  .split('/')[0]
  .replace(/^www\./, '')
  .replace(/\.$/, '');

const domainParts = value => {
  const domain = normalizeDomain(value);
  const labels = domain.split('.');
  if (labels.length < 2) throw new Error('A registrable domain is required.');
  return { domain, sld: labels.shift(), tld: labels.join('.') };
};

const xmlDecode = value => String(value || '')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

const parseAttrs = input => {
  const attrs = {};
  const pattern = /([A-Za-z0-9_:-]+)="([^"]*)"/g;
  let match;
  while ((match = pattern.exec(input))) attrs[match[1]] = xmlDecode(match[2]);
  return attrs;
};

const namecheap = async (command, params = {}, method = 'GET') => {
  if (!API_USER || !API_KEY || !USERNAME || !CLIENT_IP) {
    throw new Error('Namecheap API credentials and the whitelisted NAMECHEAP_CLIENT_IP must be configured.');
  }
  const form = new URLSearchParams({
    ApiUser: API_USER,
    ApiKey: API_KEY,
    UserName: USERNAME,
    ClientIp: CLIENT_IP,
    Command: command,
    ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
  });

  const response = method === 'POST'
    ? await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      })
    : await fetch(`${API_BASE}?${form.toString()}`);
  const xml = await response.text();
  if (!response.ok) throw new Error(`Namecheap request failed (${response.status}).`);

  const apiStatus = /<ApiResponse[^>]*Status="([^"]+)"/i.exec(xml)?.[1] || '';
  const errors = [...xml.matchAll(/<Error[^>]*Number="([^"]*)"[^>]*>([\s\S]*?)<\/Error>/gi)]
    .map(match => `${match[1]}: ${xmlDecode(match[2].trim())}`)
    .filter(Boolean);
  if (apiStatus.toUpperCase() !== 'OK' || errors.length) {
    throw new Error(errors.join('; ') || 'Namecheap returned an unsuccessful response.');
  }
  return xml;
};

const getHosts = async ({ sld, tld }) => {
  const xml = await namecheap('namecheap.domains.dns.getHosts', { SLD: sld, TLD: tld });
  const resultTag = /<DomainDNSGetHostsResult\b([^>]*)>/i.exec(xml);
  const resultAttrs = resultTag ? parseAttrs(resultTag[1]) : {};
  const hosts = [...xml.matchAll(/<Host\b([^>]*)\/>/gi)].map(match => parseAttrs(match[1]));
  return {
    usingNamecheapDns: String(resultAttrs.IsUsingOurDNS || '').toLowerCase() === 'true',
    hosts,
  };
};

const setHosts = async ({ sld, tld }, hosts) => {
  const params = { SLD: sld, TLD: tld };
  hosts.forEach((host, index) => {
    const n = index + 1;
    params[`HostName${n}`] = host.Name;
    params[`RecordType${n}`] = host.Type;
    params[`Address${n}`] = host.Address;
    params[`MXPref${n}`] = host.MXPref || '10';
    params[`TTL${n}`] = host.TTL || '1800';
  });
  await namecheap('namecheap.domains.dns.setHosts', params, 'POST');
};

const configureNamecheap = async body => {
  const parts = domainParts(body.domain);
  const netlifyHostname = normalizeDomain(body.netlify_hostname);
  if (!netlifyHostname.endsWith('.netlify.app')) throw new Error('A valid Netlify hostname is required.');

  const current = await getHosts(parts);
  if (!current.usingNamecheapDns) {
    const error = new Error('This domain is not using Namecheap BasicDNS, so host records cannot be changed safely.');
    error.status = 409;
    throw error;
  }

  const replaceableTypes = new Set(['A', 'AAAA', 'ALIAS', 'CNAME', 'URL', 'URL301', 'FRAME']);
  const preserved = current.hosts.filter(host => {
    const name = String(host.Name || '').toLowerCase();
    const type = String(host.Type || '').toUpperCase();
    return !((name === '@' || name === 'www') && replaceableTypes.has(type));
  });

  preserved.push({ Name: '@', Type: 'ALIAS', Address: body.apex_alias || 'apex-loadbalancer.netlify.com', MXPref: '10', TTL: '300' });
  preserved.push({ Name: 'www', Type: 'CNAME', Address: netlifyHostname, MXPref: '10', TTL: '300' });

  await setHosts(parts, preserved);
  return {
    ok: true,
    provider: 'namecheap',
    domain: parts.domain,
    records_preserved: current.hosts.length,
    records_written: preserved.length,
    message: 'Namecheap DNS records were updated while preserving unrelated records such as MX and TXT entries.',
  };
};

const readJson = req => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 2_000_000) {
      reject(new Error('Request body too large.'));
      req.destroy();
    }
  });
  req.on('end', () => {
    try { resolve(JSON.parse(raw || '{}')); }
    catch { reject(new Error('Request body must be valid JSON.')); }
  });
  req.on('error', reject);
});

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { ok: true, service: 'site-manager-provisioner' });
    }
    if (req.method !== 'POST' || req.url !== '/provision-namecheap') return send(res, 404, { message: 'Not found.' });
    if (!SECRET) return send(res, 503, { message: 'PROVISIONER_SECRET is not configured.' });
    if (req.headers.authorization !== `Bearer ${SECRET}`) return send(res, 401, { message: 'Unauthorized.' });

    const body = await readJson(req);
    const result = await configureNamecheap(body);
    return send(res, 200, result);
  } catch (error) {
    console.error(error);
    return send(res, Number(error?.status || 500), { message: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SITE-MANAGER DNS provisioner listening on port ${PORT}`);
});
