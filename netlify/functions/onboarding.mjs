import {
  HttpError,
  errorResponse,
  getSiteByDomainPassword,
  getSiteCustomizationCatalog,
  json,
  requireProvisioningSession,
} from './_lib.mjs';

export const handler = async event => {
  try {
    if (event.httpMethod !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const session = requireProvisioningSession(event);
    const existing = await getSiteByDomainPassword(session.domain);
    if (existing) {
      return json(200, { status: 'configured', site: existing });
    }

    const catalog = await getSiteCustomizationCatalog();
    return json(200, {
      status: 'draft',
      site: {
        id: session.site_id,
        display_domain: session.domain,
        website_url: `https://${session.domain}`,
        redirect_uri: `https://${session.domain}/callback`,
      },
      catalog: catalog.navigation_catalog,
      navigation: catalog.defaults.navigation,
      colors: catalog.defaults.colors,
      recommended_scopes: ['trade', 'application_read'],
      optional_scopes: ['account_manage', 'payment'],
      infrastructure: {
        netlify_automation: Boolean(process.env.NETLIFY_ACCESS_TOKEN && process.env.NETLIFY_SITE_ID),
        dns_automation: Boolean(process.env.PROVISIONER_URL && process.env.PROVISIONER_SECRET),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
};
