import crypto from 'node:crypto';

export const TARGET_REPO = process.env.TARGET_REPO || 'DukeNyamasege/nnn';
export const TARGET_BRANCH = process.env.TARGET_BRANCH || 'main';
const SESSION_COOKIE = 'site_manager_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  },
  body: JSON.stringify(body),
});

export const errorResponse = error => {
  console.error(error);
  if (error instanceof HttpError) {
    return json(error.status, { message: error.message, details: error.details });
  }
  return json(500, { message: error instanceof Error ? error.message : String(error) });
};

const base64url = input => Buffer.from(input).toString('base64url');
const sessionSecret = () => {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 24) throw new HttpError(500, 'SESSION_SECRET is missing or too short.');
  return value;
};

const sign = payload => crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');

export const createSessionToken = () => {
  const payload = base64url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }));
  return `${payload}.${sign(payload)}`;
};

const parseCookies = header => Object.fromEntries(
  String(header || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const index = part.indexOf('=');
      return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
    })
);

export const isAuthenticated = event => {
  try {
    const token = parseCookies(event.headers?.cookie || event.headers?.Cookie)[SESSION_COOKIE];
    if (!token) return false;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;
    const expected = sign(payload);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(decoded.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
};

export const requireAuth = event => {
  if (!isAuthenticated(event)) throw new HttpError(401, 'Manager session expired. Sign in again.');
};

export const sessionCookie = token => {
  const secure = process.env.CONTEXT === 'dev' ? '' : '; Secure';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Strict${secure}`;
};

export const clearSessionCookie = () => {
  const secure = process.env.CONTEXT === 'dev' ? '' : '; Secure';
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`;
};

const repositoryParts = () => {
  const [owner, repo, ...rest] = TARGET_REPO.split('/');
  if (!owner || !repo || rest.length) throw new HttpError(500, 'TARGET_REPO must be in owner/repository format.');
  return { owner, repo };
};

const githubToken = () => {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new HttpError(500, 'GITHUB_TOKEN is not configured on the Site Manager server.');
  return token;
};

export async function github(path, options = {}) {
  const { owner, repo } = repositoryParts();
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${githubToken()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'site-manager',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if (!response.ok) {
    const message = payload && typeof payload === 'object' && payload.message
      ? payload.message
      : `GitHub request failed (${response.status})`;
    throw new HttpError(response.status, message, payload);
  }

  return payload;
}

const encodeRepoPath = value => value.split('/').map(encodeURIComponent).join('/');

export async function readRepoFile(path, { ref = TARGET_BRANCH, optional = false } = {}) {
  try {
    const payload = await github(`contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(ref)}`);
    if (!payload || typeof payload.content !== 'string') throw new HttpError(500, `GitHub returned no content for ${path}.`);
    return {
      content: Buffer.from(payload.content.replace(/\n/g, ''), 'base64').toString('utf8'),
      sha: payload.sha,
    };
  } catch (error) {
    if (optional && error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

export async function getSites() {
  const configFile = await readRepoFile('brand.config.json');
  let config;
  try { config = JSON.parse(configFile.content); } catch { throw new HttpError(500, 'Target brand.config.json is invalid JSON.'); }
  const entries = config?.sites?.entries;
  if (!Array.isArray(entries)) throw new HttpError(500, 'Target repository has no sites.entries configuration.');
  return entries.map(site => ({
    id: String(site.id),
    display_domain: String(site.display_domain || site.hosts?.[0] || site.id),
    website_url: String(site.website_url || ''),
  }));
}

export async function requireSite(siteId) {
  const sites = await getSites();
  const site = sites.find(candidate => candidate.id === siteId);
  if (!site) throw new HttpError(400, `Unknown managed site: ${siteId}`);
  return site;
}

export const parseJsonBody = event => {
  try { return JSON.parse(event.body || '{}'); }
  catch { throw new HttpError(400, 'Request body must be valid JSON.'); }
};

export const safeAssetPath = value => {
  const path = String(value || '').replace(/\\/g, '/');
  if (!path || path.startsWith('/') || path.split('/').includes('..')) throw new HttpError(400, `Unsafe bot asset path: ${value}`);
  return path;
};

export const slugify = value => String(value || 'bot')
  .toLowerCase()
  .replace(/\.xml$/i, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60) || 'bot';

export const sha8 = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);

export const createGitBlob = content => github('git/blobs', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content, encoding: 'utf-8' }),
});

export const nowBranchSuffix = () => new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
