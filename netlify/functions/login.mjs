import { HttpError, createSessionToken, errorResponse, getSiteByDomainPassword, json, parseJsonBody, sessionCookie } from './_lib.mjs';

export const handler = async event => {
  try {
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'Method not allowed.');

    const { password } = parseJsonBody(event);
    const site = await getSiteByDomainPassword(password);
    if (!site) throw new HttpError(401, 'Domain not recognized. Enter the managed domain in lowercase, for example kicktrade.site.');

    return json(200, { ok: true, site }, { 'Set-Cookie': sessionCookie(createSessionToken(site.id)) });
  } catch (error) {
    return errorResponse(error);
  }
};
