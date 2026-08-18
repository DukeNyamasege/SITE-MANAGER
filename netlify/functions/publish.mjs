import {
  HttpError,
  TARGET_BRANCH,
  createGitBlob,
  errorResponse,
  github,
  json,
  nowBranchSuffix,
  parseJsonBody,
  readRepoFile,
  requireSiteAccess,
  safeAssetPath,
  sha8,
  slugify,
} from './_lib.mjs';

const MAX_UPLOAD_BYTES = 1_500_000;
const DOMAIN_ROOT = 'public/free-bots/domains';
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

const parseOldDomainManifest = content => {
  if (!content) return [];
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.bots) ? parsed.bots : [];
  } catch {
    return [];
  }
};

export const handler = async event => {
  try {
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'Method not allowed.');

    const body = parseJsonBody(event);
    const siteId = String(body.site_id || '');
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items) throw new HttpError(400, 'items must be an array.');
    if (items.length > 100) throw new HttpError(400, 'A domain cannot publish more than 100 bots at once.');

    const site = await requireSiteAccess(event, siteId);
    const domainManifestPath = `${DOMAIN_ROOT}/${site.id}.json`;
    const existingDomainFile = await readRepoFile(domainManifestPath, { optional: true });
    const oldDomainBots = parseOldDomainManifest(existingDomainFile?.content);
    const newBots = [];
    const newAssets = [];
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
        newBots.push(bot);
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

      const asset = `uploads/${site.id}/${id}.xml`;
      newAssets.push({ path: `${LIBRARY_ROOT}/${asset}`, content: xml });
      newBots.push({
        id,
        name: String(item.name || fileName.replace(/\.xml$/i, '')),
        file: fileName,
        asset,
        description: 'Uploaded custom Blockly strategy.',
        emoji: 'CUSTOM',
        priority,
      });
    }

    const manifest = {
      version: 1,
      site_id: site.id,
      count: newBots.length,
      bots: newBots,
    };
    const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;

    const referencedAssets = new Set(newBots.map(bot => bot.asset));
    const removablePrefix = `uploads/${site.id}/`;
    const deletePaths = oldDomainBots
      .map(bot => String(bot?.asset || ''))
      .filter(asset => asset.startsWith(removablePrefix) && !referencedAssets.has(asset))
      .map(asset => `${LIBRARY_ROOT}/${safeAssetPath(asset)}`);

    if (existingDomainFile && existingDomainFile.content === manifestContent && newAssets.length === 0 && deletePaths.length === 0) {
      return json(200, { status: 'no_changes', message: 'This domain is already published with the same bot list and order.' });
    }

    const mainRef = await github(`git/ref/heads/${encodeURIComponent(TARGET_BRANCH)}`);
    const mainSha = mainRef?.object?.sha;
    if (!mainSha) throw new HttpError(500, `Could not resolve ${TARGET_BRANCH}.`);
    const mainCommit = await github(`git/commits/${mainSha}`);
    const baseTree = mainCommit?.tree?.sha;
    if (!baseTree) throw new HttpError(500, 'Could not resolve the target repository tree.');

    const tree = [];
    for (const asset of newAssets) {
      const blob = await createGitBlob(asset.content);
      tree.push({ path: asset.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const manifestBlob = await createGitBlob(manifestContent);
    tree.push({ path: domainManifestPath, mode: '100644', type: 'blob', sha: manifestBlob.sha });
    for (const path of Array.from(new Set(deletePaths))) {
      tree.push({ path, mode: '100644', type: 'blob', sha: null });
    }

    const newTree = await github('git/trees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_tree: baseTree, tree }),
    });

    const commit = await github('git/commits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Update bots for ${site.display_domain}`,
        tree: newTree.sha,
        parents: [mainSha],
      }),
    });

    const branch = `bot-manager/${site.id}-${nowBranchSuffix()}`;
    await github('git/refs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });

    const pr = await github('pulls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `Update bots for ${site.display_domain}`,
        head: branch,
        base: TARGET_BRANCH,
        body: [
          `Automated bot-library publish for **${site.display_domain}**.`,
          '',
          `Bots: ${newBots.length}`,
          `Uploaded assets: ${newAssets.length}`,
          `Removed domain assets: ${deletePaths.length}`,
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
      site_id: site.id,
      message: `Validation PR #${pr.number} created.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
};
