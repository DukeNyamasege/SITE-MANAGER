import { HttpError, errorResponse, json, readRepoFile, requireAuth, requireSite } from './_lib.mjs';

const parseManifest = (content, label) => {
  let manifest;
  try { manifest = JSON.parse(content); }
  catch { throw new HttpError(500, `${label} is invalid JSON.`); }
  const bots = Array.isArray(manifest) ? manifest : manifest?.bots;
  if (!Array.isArray(bots)) throw new HttpError(500, `${label} does not contain a bots array.`);
  return bots
    .filter(bot => bot && typeof bot.file === 'string')
    .map(bot => ({ ...bot, priority: Number(bot.priority ?? 999) }))
    .sort((a, b) => Number(a.priority) - Number(b.priority));
};

export const handler = async event => {
  try {
    if (event.httpMethod !== 'GET') throw new HttpError(405, 'Method not allowed.');
    requireAuth(event);
    const siteId = String(event.queryStringParameters?.site_id || '');
    const site = await requireSite(siteId);

    const domainPath = `public/free-bots/domains/${site.id}.json`;
    const domainManifest = await readRepoFile(domainPath, { optional: true });
    if (domainManifest) {
      return json(200, {
        site,
        source: 'domain',
        inherited: false,
        bots: parseManifest(domainManifest.content, domainPath),
      });
    }

    const sharedPath = 'public/free-bots/bots.json';
    const sharedManifest = await readRepoFile(sharedPath);
    return json(200, {
      site,
      source: 'shared',
      inherited: true,
      bots: parseManifest(sharedManifest.content, sharedPath),
    });
  } catch (error) {
    return errorResponse(error);
  }
};
