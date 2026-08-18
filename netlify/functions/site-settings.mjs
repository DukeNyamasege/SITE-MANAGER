import {
  HttpError,
  errorResponse,
  getSiteCustomizationCatalog,
  json,
  readRepoFile,
  requireSiteAccess,
} from './_lib.mjs';

const parseDomainSettings = (content, siteId, catalog) => {
  if (!content) return null;
  let payload;
  try { payload = JSON.parse(content); }
  catch { throw new HttpError(500, `Site customization for ${siteId} is invalid JSON.`); }

  const navigation = Array.isArray(payload.navigation) ? payload.navigation.map(String) : catalog.defaults.navigation;
  const colors = payload.colors && typeof payload.colors === 'object' ? payload.colors : catalog.defaults.colors;
  return { navigation, colors };
};

export const handler = async event => {
  try {
    if (event.httpMethod !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const requestedSiteId = String(event.queryStringParameters?.site_id || '');
    const site = await requireSiteAccess(event, requestedSiteId);
    const catalog = await getSiteCustomizationCatalog();
    const path = `public/site-config/domains/${site.id}.json`;
    const file = await readRepoFile(path, { optional: true });
    const domain = parseDomainSettings(file?.content, site.id, catalog);

    return json(200, {
      site,
      inherited: !domain,
      catalog: catalog.navigation_catalog,
      navigation: domain?.navigation || catalog.defaults.navigation,
      colors: { ...catalog.defaults.colors, ...(domain?.colors || {}) },
    });
  } catch (error) {
    return errorResponse(error);
  }
};
