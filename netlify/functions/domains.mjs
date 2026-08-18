import {
  HttpError,
  errorResponse,
  getSiteByDomainPassword,
  json,
  requireSession,
} from './_lib.mjs';

export const handler = async event => {
  try {
    if (event.httpMethod !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const session = requireSession(event);
    const existing = session.domain ? await getSiteByDomainPassword(session.domain) : undefined;

    if (existing) {
      return json(200, { domains: [existing], onboarding: false });
    }

    if (session.mode !== 'provision' || !session.domain) {
      throw new HttpError(401, 'The configured domain is no longer available. Enter the domain again.');
    }

    return json(200, {
      onboarding: true,
      domains: [{
        id: session.site_id,
        display_domain: session.domain,
        website_url: `https://${session.domain}`,
        redirect_uri: `https://${session.domain}/callback`,
      }],
    });
  } catch (error) {
    return errorResponse(error);
  }
};
