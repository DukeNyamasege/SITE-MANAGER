import {
  HttpError,
  TARGET_BRANCH,
  createGitBlob,
  errorResponse,
  getSiteByDomainPassword,
  getSiteCustomizationCatalog,
  github,
  json,
  nowBranchSuffix,
  parseJsonBody,
  readRepoFile,
  requireProvisioningSession,
  safeAssetPath,
  sha8,
  slugify,
} from './_lib.mjs';
import { checkDomainOwnership } from './_domain-verification.mjs';

const MAX_UPLOAD_BYTES = 1_500_000;
const MAX_BOTS = 100;
const HEX = /^#[0-9a-f]{6}$/i;
const ALLOWED_SCOPES = new Set(['trade', 'application_read', 'account_manage', 'payment']);
const LIBRARY_ROOT = 'public/free-bots';

const cleanExistingBot = (input, priority) => {
  if (!input || typeof input !== 'object' || typeof input.file !== 'string') {
    throw new HttpError(400, `Bot at position ${priority} is invalid.`);
  }
  const asset = safeAssetPath(input.asset || input.file);
  const result = {
    id: String(input.id || slugify(input.name || input.title || input.file)),
    name: String(input.name || input.title || input.file.replace(/\.xml$/i, '')),
    file: String(input.file),
    asset,
    description: String(input.description || 'Configured bot strategy.'),
    emoji: String(input.emoji || 'CUSTOM'),
    priority,
  };
  if (input.encoding === 'gzip-base64') result.encoding = 'gzip-base64';
  if (input.is_premium === true) result.is_premium = true;
  if (typeof input.guide === 'string' && input.guide) result.guide = safeAssetPath(input.guide);
  return result;
};

const validateNavigationAndColors = async body => {
  const catalog = await getSiteCustomizationCatalog();
  const allowed = new Set(catalog.navigation_catalog.map(item => item.id));
  const required = catalog.navigation_catalog.filter(item => item.required).map(item => item.id);
  const navigation = Array.isArray(body.navigation) ? body.navigation.map(String) : [...catalog.defaults.navigation];
  if (!navigation.length) throw new HttpError(400, 'Navigation must contain at least one feature.');
  if (new Set(navigation).size !== navigation.length) throw new HttpError(400, 'Navigation contains duplicate features.');
  for (const id of navigation) if (!allowed.has(id)) throw new HttpError(400, `Navigation feature ${id} is not available on this template.`);
  for (const id of required) if (!navigation.includes(id)) throw new HttpError(400, `${id} is required and cannot be removed.`);

  const inputColors = body.colors && typeof body.colors === 'object' ? body.colors : {};
  const colors = {};
  for (const key of Object.keys(catalog.defaults.colors)) {
    const value = String(inputColors[key] || catalog.defaults.colors[key]).toLowerCase();
    if (!HEX.test(value)) throw new HttpError(400, `${key} must be a six-digit hex color.`);
    colors[key] = value;
  }
  return { navigation, colors };
};

const buildBots = (siteId, items) => {
  if (!Array.isArray(items)) return { bots: [], assets: [] };
  if (items.length > MAX_BOTS) throw new HttpError(400, `A site cannot publish more than ${MAX_BOTS} bots at once.`);

  const bots = [];
  const assets = [];
  const usedIds = new Set();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const priority = index + 1;
    if (item?.kind === 'existing') {
      const bot = cleanExistingBot(item.bot, priority);
      let id = bot.id;
      let suffix = 2;
      while (usedIds.has(id)) id = `${bot.id}-${suffix++}`;
      bot.id = id;
      usedIds.add(id);
      bots.push(bot);
      continue;
    }

    if (item?.kind !== 'upload') throw new HttpError(400, `Unknown bot item at position ${priority}.`);
    const fileName = String(item.file_name || '');
    const xml = String(item.xml || '');
    if (!fileName.toLowerCase().endsWith('.xml')) throw new HttpError(400, `${fileName || `Bot ${priority}`}: only .xml uploads are allowed.`);
    if (Buffer.byteLength(xml, 'utf8') > MAX_UPLOAD_BYTES) throw new HttpError(400, `${fileName}: XML is larger than 1.5 MB.`);
    if (!/<xml[\s>]/i.test(xml) || !/<block[\s>]/i.test(xml)) throw new HttpError(400, `${fileName}: not a Blockly XML strategy.`);

    const baseId = `${slugify(item.name || fileName)}-${sha8(`${fileName}\n${xml}`)}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    const asset = `uploads/${siteId}/${id}.xml`;
    assets.push({ path: `${LIBRARY_ROOT}/${asset}`, content: xml });
    bots.push({
      id,
      name: String(item.name || fileName.replace(/\.xml$/i, '')),
      file: fileName,
      asset,
      description: 'Uploaded custom Blockly strategy.',
      emoji: 'CUSTOM',
      priority,
    });
  }

  return { bots, assets };
};

export const handler = async event => {
  try {
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'Method not allowed.');
    const session = requireProvisioningSession(event);
    const body = parseJsonBody(event);

    const existing = await getSiteByDomainPassword(session.domain);
    if (existing) {
      return json(200, { status: 'already_configured', site: existing, message: 'This domain is already configured.' });
    }

    const ownership = await checkDomainOwnership(event);
    if (!ownership.verified) {
      throw new HttpError(403, 'Verify that you control this domain before provisioning it.', {
        method: ownership.method,
        record: ownership.record,
        message: ownership.message,
      });
    }

    const clientId = String(body.client_id || '').trim();
    if (!clientId || clientId.length > 160) throw new HttpError(400, 'Enter the Deriv OAuth client/app ID from developers.deriv.com.');
    const environment = body.environment === 'staging' ? 'staging' : 'production';
    const scopes = Array.isArray(body.scopes) ? body.scopes.map(String).filter(Boolean) : ['trade', 'application_read'];
    if (!scopes.includes('trade')) throw new HttpError(400, 'The trade OAuth scope is required for this trading platform.');
    if (new Set(scopes).size !== scopes.length) throw new HttpError(400, 'OAuth scopes contain duplicates.');
    for (const scope of scopes) if (!ALLOWED_SCOPES.has(scope)) throw new HttpError(400, `Unsupported OAuth scope: ${scope}`);
    const legacyAppId = String(body.legacy_app_id || '').trim();
    const { navigation, colors } = await validateNavigationAndColors(body);
    const { bots, assets } = buildBots(session.site_id, body.items || []);

    const brandFile = await readRepoFile('brand.config.json');
    let brand;
    try { brand = JSON.parse(brandFile.content); }
    catch { throw new HttpError(500, 'Target brand.config.json is invalid JSON.'); }
    if (!Array.isArray(brand?.sites?.entries)) throw new HttpError(500, 'Target repository has no sites.entries configuration.');

    if (brand.sites.entries.some(site => String(site.id) === session.site_id)) {
      throw new HttpError(409, `The generated site id ${session.site_id} is already in use. Enter a different domain.`);
    }

    const domain = session.domain;
    const siteEntry = {
      id: session.site_id,
      hosts: [domain, `www.${domain}`],
      display_domain: domain,
      website_url: `https://${domain}`,
      redirect_uri: `https://${domain}/callback`,
      client_id: clientId,
      scopes,
      environment,
    };
    if (legacyAppId) siteEntry.legacy_app_id = legacyAppId;
    brand.sites.entries.push(siteEntry);

    const brandContent = `${JSON.stringify(brand, null, 4)}\n`;
    const siteSettingsContent = `${JSON.stringify({
      version: 1,
      site_id: session.site_id,
      navigation,
      colors,
    }, null, 2)}\n`;
    const botManifestContent = `${JSON.stringify({
      version: 1,
      site_id: session.site_id,
      count: bots.length,
      bots,
    }, null, 2)}\n`;

    const mainRef = await github(`git/ref/heads/${encodeURIComponent(TARGET_BRANCH)}`);
    const mainSha = mainRef?.object?.sha;
    if (!mainSha) throw new HttpError(500, `Could not resolve ${TARGET_BRANCH}.`);
    const mainCommit = await github(`git/commits/${mainSha}`);
    const baseTree = mainCommit?.tree?.sha;
    if (!baseTree) throw new HttpError(500, 'Could not resolve the target repository tree.');

    const tree = [];
    const files = [
      { path: 'brand.config.json', content: brandContent },
      { path: `public/site-config/domains/${session.site_id}.json`, content: siteSettingsContent },
      { path: `${LIBRARY_ROOT}/domains/${session.site_id}.json`, content: botManifestContent },
      ...assets,
    ];
    for (const file of files) {
      const blob = await createGitBlob(file.content);
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const newTree = await github('git/trees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_tree: baseTree, tree }),
    });

    const commitMessage = [
      `Provision new site ${domain}`,
      '',
      `Site ID: ${session.site_id}`,
      `Deriv client ID: ${clientId}`,
      `OAuth scopes: ${scopes.join(', ')}`,
      `Ownership: ${ownership.method}`,
      `Navigation items: ${navigation.length}`,
      `Bots: ${bots.length}`,
    ].join('\n');
    const commit = await github('git/commits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: commitMessage, tree: newTree.sha, parents: [mainSha] }),
    });

    const branch = `site-provisioner/${session.site_id}-${nowBranchSuffix()}`;
    await github('git/refs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });

    const pr = await github('pulls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `Provision new site ${domain}`,
        head: branch,
        base: TARGET_BRANCH,
        body: [
          `Automated new-site provisioning for **${domain}**.`,
          '',
          `Site ID: ${session.site_id}`,
          `Redirect URI: https://${domain}/callback`,
          `OAuth scopes: ${scopes.join(', ')}`,
          `Domain ownership: ${ownership.method}`,
          `Visible navigation items: ${navigation.length}`,
          `Initial bots: ${bots.length}`,
          '',
          'Created by SITE-MANAGER. Merge only after the target repository compatibility workflow succeeds.',
        ].join('\n'),
      }),
    });

    return json(202, {
      status: 'pending',
      pr: pr.number,
      head_sha: commit.sha,
      branch,
      site_id: session.site_id,
      message: `Provisioning PR #${pr.number} created.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
};
