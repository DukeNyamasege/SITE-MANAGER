import { HttpError, clearSessionCookie, errorResponse, json } from './_lib.mjs';

export const handler = async event => {
  try {
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'Method not allowed.');
    return json(200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
  } catch (error) {
    return errorResponse(error);
  }
};
