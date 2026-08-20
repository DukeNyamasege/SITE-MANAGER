export const NNN_NAVIGATION_CATALOG = [
  { id: 'dashboard', label: 'Dashboard', required: true },
  { id: 'bot_builder', label: 'Bot Builder' },
  { id: 'free_bots', label: 'Free Bots' },
  { id: 'auto_trader', label: 'Auto Trades' },
  { id: 'manual_trading', label: 'Manual Trading' },
  { id: 'tradingview', label: 'TradingView' },
  { id: 'bulk_trader', label: 'Bulk Trader' },
  { id: 'batch_trader', label: 'Batch Trader' },
  { id: 'speedbot', label: 'Speed Bot' },
  { id: 'copy_trading', label: 'Copy Trading' },
  { id: 'analysis_tools', label: 'Analysis Tool' },
  { id: 'calculator', label: 'Calculator' },
];

export const NNN_DEFAULT_NAVIGATION = NNN_NAVIGATION_CATALOG.map(item => item.id);
export const NNN_DEFAULT_COLORS = { primary: '#059669', secondary: '#19cba3', nav_background: '#151d26', nav_text: '#f3f6f8', header_background: '#ffffff' };
export const NNN_RECOMMENDED_SCOPES = ['trade', 'application_read'];
const NAVIGATION_IDS = new Set(NNN_DEFAULT_NAVIGATION);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeNnnNavigation(value) {
  const source = Array.isArray(value) ? value : NNN_DEFAULT_NAVIGATION;
  const seen = new Set();
  const normalized = source.map(item => String(item)).filter(item => NAVIGATION_IDS.has(item) && !seen.has(item) && Boolean(seen.add(item)));
  if (!normalized.includes('dashboard')) normalized.unshift('dashboard');
  return normalized.length ? normalized : ['dashboard'];
}

export function normalizeNnnColors(value) {
  const source = value && typeof value === 'object' ? value : {};
  const next = { ...NNN_DEFAULT_COLORS };
  for (const key of Object.keys(next)) {
    const candidate = String(source[key] ?? '');
    if (HEX_COLOR.test(candidate)) next[key] = candidate.toLowerCase();
  }
  return next;
}

export function normalizeDerivScopes(value) {
  const allowed = new Set(['trade', 'application_read']);
  const source = Array.isArray(value) ? value : NNN_RECOMMENDED_SCOPES;
  const scopes = [...new Set(source.map(item => String(item)).filter(item => allowed.has(item)))];
  return scopes.includes('trade') ? scopes : ['trade', ...scopes];
}

export function toNnnSiteCustomization(website, config) {
  return { version: 1, site_id: website.site_key, navigation: normalizeNnnNavigation(config?.navigation), colors: normalizeNnnColors(config?.colors) };
}

export function toNnnRegistryEntry(website, config) {
  const domain = String(website.primary_domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const clientId = String(config?.deriv_client_id || '').trim();
  if (!domain || !clientId) return null;
  const host = domain.replace(/^www\./, '');
  return {
    id: website.site_key,
    hosts: [host, `www.${host}`],
    display_domain: host,
    website_url: `https://${host}`,
    redirect_uri: `https://${host}/callback`,
    client_id: clientId,
    scopes: normalizeDerivScopes(config?.deriv_scopes),
    environment: config?.deriv_environment === 'staging' ? 'staging' : 'production',
  };
}

export function builderReadiness(_website, config) {
  const missing = [];
  if (!String(config?.brand_name || '').trim()) missing.push('brand_name');
  if (!normalizeNnnNavigation(config?.navigation).includes('dashboard')) missing.push('dashboard');
  const colors = normalizeNnnColors(config?.colors);
  if (Object.values(colors).some(value => !HEX_COLOR.test(value))) missing.push('colors');
  return {
    configuration_ready: missing.length === 0,
    // Deployment readiness is authoritative only in /api/v2/domains after Step 6,
    // because it also requires preview approval, ownership, VPS routing and HTTPS eligibility.
    deployment_ready: false,
    missing,
  };
}
