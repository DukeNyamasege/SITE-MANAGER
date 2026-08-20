import crypto from 'node:crypto';
import { normalizeDerivScopes, normalizeNnnColors, normalizeNnnNavigation } from './nnn-contract.js';

const cleanHost = value => String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
const cleanUrl = value => String(value || '').trim().replace(/\/$/, '');
const sortedUnique = values => [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))].sort();
const sortedHosts = values => sortedUnique(values.map(cleanHost).filter(Boolean));
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expectedHosts(importItem) {
  return sortedHosts([importItem.display_domain, ...(Array.isArray(importItem.hosts) ? importItem.hosts : [])]);
}

function actualHosts(domains) {
  return sortedHosts((Array.isArray(domains) ? domains : []).map(domain => domain.hostname));
}

function primaryDomain(domains) {
  return (Array.isArray(domains) ? domains : []).find(domain => domain.is_primary) || null;
}

export function v2ParityFingerprint({ website, config, domains }) {
  const payload = {
    site_key: website.site_key,
    primary_domain: cleanHost(website.primary_domain),
    status: website.status,
    deployment_status: website.deployment_status,
    preview_approved_at: website.preview_approved_at || null,
    config: {
      navigation: normalizeNnnNavigation(config.navigation),
      colors: normalizeNnnColors(config.colors),
      deriv_client_id: String(config.deriv_client_id || '').trim(),
      deriv_scopes: sortedUnique(normalizeDerivScopes(config.deriv_scopes)),
      deriv_environment: config.deriv_environment === 'staging' ? 'staging' : 'production',
      configuration_status: config.configuration_status,
      brand_name: String(config.brand_name || ''),
      tagline: String(config.tagline || ''),
      logo_url: String(config.logo_url || ''),
    },
    domains: (Array.isArray(domains) ? domains : []).map(domain => ({
      hostname: cleanHost(domain.hostname),
      is_primary: Boolean(domain.is_primary),
      ownership_status: domain.ownership_status,
      routing_status: domain.routing_status,
      ssl_status: domain.ssl_status,
    })).sort((a, b) => a.hostname.localeCompare(b.hostname)),
  };
  return sha256(JSON.stringify(payload));
}

export function evaluateDualRunParity({ importItem, website, config, domains, parityReport }) {
  const snapshot = importItem.source_snapshot || {};
  const registry = snapshot.registry_entry || {};
  const legacyCustomization = snapshot.customization || importItem.customization || {};
  const runtimeEvidence = parityReport?.runtime_evidence || {};
  const primary = primaryDomain(domains);
  const expectedDomain = cleanHost(importItem.display_domain || registry.display_domain);
  const actualPrimary = cleanHost(primary?.hostname || website.primary_domain);
  const expectedCallback = cleanUrl(importItem.redirect_uri || registry.redirect_uri);
  const actualCallback = actualPrimary ? `https://${actualPrimary}/callback` : '';
  const reportCurrent = Boolean(
    parityReport
    && parityReport.legacy_source_fingerprint === importItem.source_fingerprint
    && parityReport.legacy_source_commit === importItem.source_commit,
  );

  const checks = {
    migrated_site_linked: website.source === 'migrated' && importItem.status === 'assigned' && importItem.website_id === website.id,
    legacy_site_id_preserved: importItem.legacy_site_id === website.site_key,
    source_not_drifted: importItem.drift_status === 'current' && importItem.assigned_source_fingerprint === importItem.source_fingerprint,
    primary_domain_matches: Boolean(expectedDomain && actualPrimary === expectedDomain),
    domain_aliases_match: sameJson(actualHosts(domains), expectedHosts(importItem)),
    domain_ownership_verified: (Array.isArray(domains) ? domains : []).length > 0
      && domains.every(domain => ['verified', 'not_required'].includes(domain.ownership_status)),
    deriv_client_matches: String(config.deriv_client_id || '').trim() === String(importItem.deriv_client_id || registry.client_id || '').trim(),
    deriv_scopes_match: sameJson(
      sortedUnique(normalizeDerivScopes(config.deriv_scopes)),
      sortedUnique(normalizeDerivScopes(importItem.deriv_scopes || registry.scopes)),
    ),
    deriv_environment_matches: (config.deriv_environment === 'staging' ? 'staging' : 'production')
      === (importItem.deriv_environment === 'staging' ? 'staging' : 'production'),
    redirect_uri_matches: Boolean(expectedCallback && actualCallback === expectedCallback),
    navigation_matches: sameJson(
      normalizeNnnNavigation(config.navigation),
      normalizeNnnNavigation(legacyCustomization.navigation),
    ),
    colors_match: sameJson(
      normalizeNnnColors(config.colors),
      normalizeNnnColors(legacyCustomization.colors),
    ),
    branding_matches_legacy_identity: cleanHost(config.brand_name) === expectedDomain
      && String(config.tagline || 'SMART DERIV TOOLS').trim() === 'SMART DERIV TOOLS'
      && !String(config.logo_url || '').trim(),
    configuration_complete: config.configuration_status === 'complete',
    preview_approved: Boolean(website.preview_approved_at),
    runtime_evidence_current: reportCurrent,
    runtime_registry_match: reportCurrent && runtimeEvidence.registry_entry_match === true,
    runtime_customization_assets_match: reportCurrent && runtimeEvidence.customization_assets_match === true,
    runtime_bot_manifest_match: reportCurrent && runtimeEvidence.free_bot_manifest_match === true,
    runtime_bot_assets_match: reportCurrent && runtimeEvidence.free_bot_assets_match === true,
    runtime_contract_compatible: reportCurrent && runtimeEvidence.runtime_contract_compatible === true,
    production_still_on_legacy: website.deployment_status !== 'deployed'
      && website.status !== 'live'
      && parityReport?.production_cutover_performed !== true,
  };

  const labels = {
    migrated_site_linked: 'V2 website is not linked to the audited legacy assignment.',
    legacy_site_id_preserved: 'Legacy site ID no longer matches the V2 site key.',
    source_not_drifted: 'The live nnn source changed after this site was assigned to V2.',
    primary_domain_matches: 'Primary domain differs from the legacy production registry.',
    domain_aliases_match: 'Hostname aliases differ from the legacy production registry.',
    domain_ownership_verified: 'One or more migrated hostnames are not administratively verified.',
    deriv_client_matches: 'Deriv Client/App ID differs from the legacy production site.',
    deriv_scopes_match: 'Deriv OAuth scopes differ from the legacy production site.',
    deriv_environment_matches: 'Deriv environment differs from the legacy production site.',
    redirect_uri_matches: 'Expected Deriv callback URL differs from the migrated primary hostname.',
    navigation_matches: 'Navigation/features differ from the current legacy nnn configuration.',
    colors_match: 'Theme colors differ from the current legacy nnn configuration.',
    branding_matches_legacy_identity: 'Brand name, tagline or logo differs from the legacy domain-derived identity.',
    configuration_complete: 'The V2 website configuration is not complete.',
    preview_approved: 'The current V2 preview has not been approved.',
    runtime_evidence_current: 'Held-runtime parity evidence is missing or stale for the current legacy source.',
    runtime_registry_match: 'Held nnn registry entry differs from the stable live source.',
    runtime_customization_assets_match: 'Held nnn customization/default assets differ from the stable live source.',
    runtime_bot_manifest_match: 'Held nnn site bot manifest differs from the stable live source.',
    runtime_bot_assets_match: 'One or more bot assets referenced by the live site differ in the held runtime.',
    runtime_contract_compatible: 'Held nnn runtime does not expose the required publishing/migration contracts.',
    production_still_on_legacy: 'This site already appears deployed/live in V2; Step 11 must not perform cutover.',
  };
  const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => ({ key, message: labels[key] }));
  const status = blockers.length === 0 ? 'parity_ready' : (!reportCurrent && parityReport ? 'stale' : 'blocked');

  return {
    report_version: 1,
    status,
    cutover_ready: status === 'parity_ready',
    checks,
    blockers,
    source: {
      repository: importItem.source_repository,
      commit: importItem.source_commit,
      fingerprint: importItem.source_fingerprint,
      assigned_fingerprint: importItem.assigned_source_fingerprint,
      drift_status: importItem.drift_status,
    },
    runtime: {
      held_commit: parityReport?.held_runtime_commit || '',
      evidence_current: reportCurrent,
      evidence: runtimeEvidence,
    },
    v2_fingerprint: v2ParityFingerprint({ website, config, domains }),
    production_cutover_performed: false,
  };
}
