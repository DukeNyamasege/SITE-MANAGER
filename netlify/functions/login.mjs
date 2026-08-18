import {
  HttpError,
  createSessionToken,
  domainToSiteId,
  errorResponse,
  getSiteByDomainPassword,
  json,
  parseJsonBody,
  sessionCookie,
  validateDomainName,
} from './_lib.mjs';

export const handler = async event => {
  try {
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'Method not allowed.');

    const { password, domain: domainInput } = parseJsonBody(event);
    const domain = validateDomainName(domainInput || password);
    if (!domain) throw new HttpError(400, 'Enter a valid domain name.');

    const site = await getSiteByDomainPassword(domain);
    if (site) {
      const token = createSessionToken({ site_id: site.id, domain, mode: 'manage' });
      return json(200, { ok: true, mode: 'manage', site }, { 'Set-Cookie': sessionCookie(token) });
    }

    const siteId = domainToSiteId(domain);
    const draftSite = {
      id: siteId,
      display_domain: domain,
      website_url: `https://${domain}`,
      redirect_uri: `https://${domain}/callback`,
    };
    const token = createSessionToken({ site_id: siteId, domain, mode: 'provision' });

    return json(200, {
      ok: true,
      mode: 'provision',
      site: draftSite,
      message: 'This domain is not configured yet. Start the new-site setup wizard.',
    }, { 'Set-Cookie': sessionCookie(token) });
  } catch (error) {
    return errorResponse(error);
  }
};
