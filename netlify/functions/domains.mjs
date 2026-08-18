import { HttpError, errorResponse, getSites, json, requireAuth } from './_lib.mjs';

export const handler = async event => {
  try {
    if (event.httpMethod !== 'GET') throw new HttpError(405, 'Method not allowed.');
    requireAuth(event);
    const domains = await getSites();
    return json(200, { domains });
  } catch (error) {
    return errorResponse(error);
  }
};
