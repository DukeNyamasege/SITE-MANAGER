import { HttpError, errorResponse, json, requireSiteAccess } from './_lib.mjs';

export const handler = async event => {
  try {
    if (event.httpMethod !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const site = await requireSiteAccess(event);
    return json(200, { domains: [site] });
  } catch (error) {
    return errorResponse(error);
  }
};
