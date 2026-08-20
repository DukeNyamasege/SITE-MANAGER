import crypto from 'node:crypto';

export const CUTOVER_CONTRACT_VERSION = 1;
export const CUTOVER_PLAN_VERSION = 1;
export const CANARY_CONTRACT_VERSION = 1;

const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const cleanHost = value => String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
const sortedUnique = values => [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))].sort();

export function cutoverSettings() {
  return {
    planTtlMinutes: Math.max(15, Math.min(24 * 60, Number(process.env.CUTOVER_PLAN_TTL_MINUTES || 120))),
    defaultRollbackWindowMinutes: Math.max(5, Math.min(240, Number(process.env.CUTOVER_ROLLBACK_WINDOW_MINUTES || 30))),
    executionEnabled: false,
    routingTarget: {
      ipv4: String(process.env.VPS_PUBLIC_IPV4 || '').split(',').map(item => item.trim()).filter(Boolean),
      ipv6: String(process.env.VPS_PUBLIC_IPV6 || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean),
      cname: cleanHost(process.env.VPS_CNAME_TARGET || ''),
    },
  };
}

export function hasRoutingTarget(target) {
  return Boolean(target?.cname || target?.ipv4?.length || target?.ipv6?.length);
}

export function buildCutoverSnapshot({ context, parity, rollbackWindowMinutes, createdAt = new Date() }) {
  const { website, config, importItem, domains, parityReport } = context;
  const settings = cutoverSettings();
  const primary = (domains || []).find(domain => domain.is_primary) || null;
  const hostname = cleanHost(primary?.hostname || website.primary_domain);
  const sourceSnapshot = importItem.source_snapshot || {};
  const registry = sourceSnapshot.registry_entry || {};
  const runtimeEvidence = parityReport?.runtime_evidence || {};
  const rollbackWindow = Math.max(5, Math.min(240, Number(rollbackWindowMinutes || settings.defaultRollbackWindowMinutes)));
  const expiresAt = new Date(createdAt.getTime() + settings.planTtlMinutes * 60 * 1000);

  const paritySnapshot = {
    report_version: parity.report_version,
    status: parity.status,
    checks: parity.checks,
    blockers: parity.blockers,
    legacy_source_commit: parity.source.commit,
    legacy_source_fingerprint: parity.source.fingerprint,
    assigned_source_fingerprint: parity.source.assigned_fingerprint,
    held_runtime_commit: parity.runtime.held_commit,
    v2_fingerprint: parity.v2_fingerprint,
    parity_report_id: parityReport?.id || '',
    parity_checked_at: parityReport?.checked_at || null,
    preview_approved_at: website.preview_approved_at || null,
  };

  const runtimeSnapshot = {
    runtime: 'nnn',
    held_runtime_commit: parity.runtime.held_commit,
    publishing_contract_version: 2,
    migration_contract_version: 1,
    cutover_contract_version: Number(runtimeEvidence.cutover_contract_version || 0),
    cutover_contract_compatible: runtimeEvidence.cutover_contract_compatible === true,
    canary_contract_version: Number(runtimeEvidence.canary_contract_version || 0),
    canary_contract_compatible: runtimeEvidence.canary_contract_compatible === true,
    runtime_evidence: runtimeEvidence,
    health_resource: '/site-manager-runtime.json',
    planned_health_url: hostname ? `https://${hostname}/site-manager-runtime.json` : '',
  };

  const rollbackSnapshot = {
    strategy: 'restore-legacy-nnn-production',
    source_repository: importItem.source_repository,
    source_commit: importItem.source_commit,
    source_fingerprint: importItem.source_fingerprint,
    legacy_site_id: importItem.legacy_site_id,
    legacy_website_url: String(importItem.website_url || registry.website_url || ''),
    legacy_redirect_uri: String(importItem.redirect_uri || registry.redirect_uri || ''),
    primary_hostname: cleanHost(importItem.display_domain || registry.display_domain),
    hosts: sortedUnique([importItem.display_domain, ...(Array.isArray(importItem.hosts) ? importItem.hosts : [])].map(cleanHost)),
    rollback_window_minutes: rollbackWindow,
    rollback_deadline: null,
    dns_or_provider_rollback_requires_execution_step: true,
  };

  const preflightSnapshot = {
    parity_ready: parity.cutover_ready === true,
    source_current: parity.checks.source_not_drifted === true && parity.checks.runtime_evidence_current === true,
    template_cutover_contract_ready: runtimeEvidence.cutover_contract_compatible === true,
    template_canary_contract_ready: runtimeEvidence.canary_contract_compatible === true,
    primary_hostname: hostname,
    routing_target: settings.routingTarget,
    routing_target_configured: hasRoutingTarget(settings.routingTarget),
    expected_callback_url: hostname ? `https://${hostname}/callback` : '',
    deriv_client_id: String(config.deriv_client_id || ''),
    deriv_scopes: Array.isArray(config.deriv_scopes) ? config.deriv_scopes : [],
    deriv_environment: config.deriv_environment === 'staging' ? 'staging' : 'production',
    production_cutover_performed: false,
    execution_enabled: false,
  };

  const fingerprintPayload = {
    website_id: website.id,
    site_key: website.site_key,
    primary_hostname: hostname,
    legacy_import_id: importItem.id,
    parity_report_id: parityReport?.id || '',
    parity_snapshot: paritySnapshot,
    runtime_snapshot: runtimeSnapshot,
    rollback_snapshot: rollbackSnapshot,
    preflight_snapshot: preflightSnapshot,
    rollback_window_minutes: rollbackWindow,
    expires_at: expiresAt.toISOString(),
  };

  return {
    primaryHostname: hostname,
    legacySourceCommit: importItem.source_commit,
    legacySourceFingerprint: importItem.source_fingerprint,
    heldRuntimeCommit: parity.runtime.held_commit,
    v2Fingerprint: parity.v2_fingerprint,
    paritySnapshot,
    runtimeSnapshot,
    rollbackSnapshot,
    preflightSnapshot,
    rollbackWindowMinutes: rollbackWindow,
    expiresAt,
    planFingerprint: sha256(JSON.stringify(fingerprintPayload)),
  };
}

export function evaluateCutoverPlan({ plan, parity }) {
  const runtimeEvidence = parity.runtime?.evidence || {};
  const expired = new Date(plan.expires_at).getTime() <= Date.now();
  const comparisons = {
    plan_actionable: ['prepared', 'armed'].includes(plan.status),
    parity_ready: parity.cutover_ready === true,
    source_commit_current: plan.legacy_source_commit === parity.source.commit,
    source_fingerprint_current: plan.legacy_source_fingerprint === parity.source.fingerprint,
    held_runtime_current: plan.held_runtime_commit === parity.runtime.held_commit,
    v2_fingerprint_current: plan.v2_fingerprint === parity.v2_fingerprint,
    cutover_contract_current: Number(runtimeEvidence.cutover_contract_version || 0) === CUTOVER_CONTRACT_VERSION
      && runtimeEvidence.cutover_contract_compatible === true,
    canary_contract_current: Number(runtimeEvidence.canary_contract_version || 0) === CANARY_CONTRACT_VERSION
      && runtimeEvidence.canary_contract_compatible === true,
    routing_target_configured: plan.preflight_snapshot?.routing_target_configured === true,
    plan_not_expired: !expired,
    production_still_legacy: parity.checks?.production_still_on_legacy === true,
  };
  const blockers = Object.entries(comparisons).filter(([, value]) => !value).map(([key]) => key);
  return {
    current: blockers.length === 0,
    expired,
    comparisons,
    blockers,
    execution_enabled: false,
    canary_simulation_eligible: blockers.length === 0 && plan.status === 'armed',
    production_cutover_performed: false,
  };
}
