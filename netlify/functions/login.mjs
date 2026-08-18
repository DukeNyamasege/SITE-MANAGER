import crypto from 'node:crypto';
import { HttpError, createSessionToken, errorResponse, json, parseJsonBody, sessionCookie } from './_lib.mjs';

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export const handler = async event => {
  try {
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'Method not allowed.');
    const expected = process.env.MANAGER_PASSWORD;
    if (!expected || expected.length < 8) throw new HttpError(500, 'MANAGER_PASSWORD is not configured securely.');

    const { password } = parseJsonBody(event);
    if (!safeEqual(password || '', expected)) throw new HttpError(401, 'Incorrect manager password.');

    return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(createSessionToken()) });
  } catch (error) {
    return errorResponse(error);
  }
};
