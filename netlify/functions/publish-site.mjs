import {
  HttpError,
  TARGET_BRANCH,
  createGitBlob,
  errorResponse,
  getSiteCustomizationCatalog,
  github,
  json,
  nowBranchSuffix,
  parseJsonBody,
  readRepoFile,
  requireSiteAccess,
} from './_lib.mjs';

const HEX = /^#[0-9a-f]{6}$/i;
const SETTINGS_ROOT = 'public/site-config/domains';

export const handler = async event => {
  try {
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'Method not allowed.');
    const body = parseJsonBody(event);
    const site = await requireSiteAccess(event, String(body.site_id || ''));
    const catalog = await getSiteCustomizationCatalog();
    const allowed = new Set(catalog.navigation_catalog.map(item => item.id));
    const required = catalog.navigation_catalog.filter(item => item.required).map(item => item.id);

    const navigation = Array.isArray(body.navigation) ? body.navigation.map(String) : null;
    if (!navigation || navigation.length === 0) throw new HttpError(400, 'Navigation must contain at least one feature.');
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

    const payload = {
      version: 1,
      site_id: site.id,
      navigation,
      colors,
    };
    const content = `${JSON.stringify(payload, null, 2)}\n`;
    const path = `${SETTINGS_ROOT}/${site.id}.json`;
    const existing = await readRepoFile(path, { optional: true });
    if (existing?.content === content) {
      return json(200, { status: 'no_changes', message: 'Navigation and theme already match the published site.' });
    }

    const mainRef = await github(`git/ref/heads/${encodeURIComponent(TARGET_BRANCH)}`);
    const mainSha = mainRef?.object?.sha;
    if (!mainSha) throw new HttpError(500, `Could not resolve ${TARGET_BRANCH}.`);
    const mainCommit = await github(`git/commits/${mainSha}`);
    const baseTree = mainCommit?.tree?.sha;
    if (!baseTree) throw new HttpError(500, 'Could not resolve the target repository tree.');

    const blob = await createGitBlob(content);
    const newTree = await github('git/trees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_tree: baseTree,
        tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }],
      }),
    });

    const commitMessage = [
      `Update navigation and theme on ${site.display_domain}`,
      '',
      `Navigation: ${navigation.join(' > ')}`,
      `Primary: ${colors.primary}`,
      `Secondary: ${colors.secondary}`,
      `Nav background: ${colors.nav_background}`,
    ].join('\n');

    const commit = await github('git/commits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: commitMessage, tree: newTree.sha, parents: [mainSha] }),
    });

    const branch = `site-manager/${site.id}-${nowBranchSuffix()}`;
    await github('git/refs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });

    const pr = await github('pulls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `Update navigation and theme on ${site.display_domain}`,
        head: branch,
        base: TARGET_BRANCH,
        body: [
          `Automated navigation/theme publish for **${site.display_domain}**.`,
          '',
          `Visible navigation (${navigation.length}): ${navigation.join(' → ')}`,
          `Primary: ${colors.primary}`,
          `Secondary: ${colors.secondary}`,
          `Navigation background: ${colors.nav_background}`,
          `Navigation text: ${colors.nav_text}`,
          `Header background: ${colors.header_background}`,
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
