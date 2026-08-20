import crypto from 'node:crypto';

export const PRODUCTION_ELIGIBILITY_CONTRACT_VERSION = 1;

const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const cleanHost = value => String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');

export function productionEligibilitySettings() {
  return {
    ttlMinutes: Math.max(15, Math.min(240, Number(process.env.PRODUCTION_ELIGIBILITY_TTL_MINUTES || 60))),
    stagingMaxAgeMinutes: Math.max(5, Math.min(24 * 60, Number(process.env.PRODUCTION_ELIGIBILITY_STAGING_MAX_AGE_MINUTES || 60))),
    executionEnabled: false,
  };
}

function stagingAgeMinutes(stagingRun, now) {
  const passedAt = stagingRun?.passed_at ? new Date(stagingRun.passed_at).getTime() : 0;
  return passedAt ? Math.max(0, (now.getTime() - passedAt) / 60_000) : Number.POSITIVE_INFINITY;
}

export function buildProductionEligibilitySnapshot({
  website,
  importItem,
  parityReport,
  parity,
  plan,
  planEvaluation,
  canary,
  stagingRun,
  now = new Date(),
}) {
  const settings = productionEligibilitySettings();
  const runtimeEvidence = parityReport?.runtime_evidence || {};
  const primaryHostname = cleanHost(plan?.primary_hostname || website?.primary_domain || '');
  const stagingAge = stagingAgeMinutes(stagingRun, now);
  const stagingHealth = stagingRun?.health_snapshot || {};

  const checks = {
    migrated_site_linked: website?.source === 'migrated' && importItem?.status === 'assigned' && importItem?.website_id === website?.id,
    production_still_legacy: parity?.checks?.production_still_on_legacy === true
      && website?.status !== 'live'
      && website?.deployment_status !== 'deployed',
    parity_ready: parity?.cutover_ready === true,
    parity_report_current: parity?.runtime?.evidence_current === true && parityReport?.status === 'parity_ready',
    plan_armed: plan?.status === 'armed',
    plan_current: planEvaluation?.current === true,
    canary_passed: canary?.status === 'passed',
    canary_matches_plan: Boolean(canary?.plan_id && canary.plan_id === plan?.id),
    canary_runtime_matches: Boolean(canary?.held_runtime_commit && canary.held_runtime_commit === plan?.held_runtime_commit),
    canary_production_unchanged: canary?.production_traffic_changed === false && canary?.production_cutover_performed === false,
    staging_passed: stagingRun?.status === 'passed',
    staging_matches_canary: Boolean(stagingRun?.canary_execution_id && stagingRun.canary_execution_id === canary?.id),
    staging_matches_plan: Boolean(stagingRun?.plan_id && stagingRun.plan_id === plan?.id),
    staging_runtime_matches: Boolean(stagingRun?.held_runtime_commit && stagingRun.held_runtime_commit === plan?.held_runtime_commit),
    staging_health_passed: stagingHealth?.ok === true,
    staging_evidence_fresh: Number.isFinite(stagingAge) && stagingAge <= settings.stagingMaxAgeMinutes,
    staging_production_unchanged: stagingRun?.production_traffic_changed === false && stagingRun?.production_cutover_performed === false,
    runtime_production_eligibility_contract: Number(runtimeEvidence.production_eligibility_contract_version || 0) === PRODUCTION_ELIGIBILITY_CONTRACT_VERSION
      && runtimeEvidence.production_eligibility_contract_compatible === true,
    held_runtime_consistent: Boolean(
      parity?.runtime?.held_commit
      && parity.runtime.held_commit === plan?.held_runtime_commit
      && plan.held_runtime_commit === canary?.held_runtime_commit
      && canary.held_runtime_commit === stagingRun?.held_runtime_commit,
    ),
    v2_fingerprint_current: Boolean(parity?.v2_fingerprint && plan?.v2_fingerprint === parity.v2_fingerprint),
    primary_hostname_current: Boolean(primaryHostname && primaryHostname === cleanHost(website?.primary_domain)),
    rollback_evidence_preserved: Boolean(
      plan?.rollback_snapshot?.source_commit
      && plan.rollback_snapshot.source_fingerprint
      && plan.rollback_snapshot.legacy_site_id === website?.site_key
      && Number(plan.rollback_snapshot.rollback_window_minutes || 0) > 0,
    ),
  };

  const labels = {
    migrated_site_linked: 'Website is not the assigned migrated legacy site.',
    production_still_legacy: 'The website no longer appears to be running only on legacy production.',
    parity_ready: 'Current Step 11 parity is not ready.',
    parity_report_current: 'Parity evidence is missing or stale.',
    plan_armed: 'Step 12 cutover plan is not armed.',
    plan_current: 'The armed cutover plan no longer matches current evidence.',
    canary_passed: 'Step 13 canary has not passed.',
    canary_matches_plan: 'Passed canary does not belong to the current armed plan.',
    canary_runtime_matches: 'Passed canary used a different held nnn runtime.',
    canary_production_unchanged: 'Canary evidence indicates a production change, which Step 15 forbids.',
    staging_passed: 'Step 14 real staging-edge rehearsal has not passed.',
    staging_matches_canary: 'Passed staging rehearsal does not belong to the passed canary.',
    staging_matches_plan: 'Passed staging rehearsal does not belong to the current armed plan.',
    staging_runtime_matches: 'Passed staging rehearsal used a different held nnn runtime.',
    staging_health_passed: 'Passed staging evidence does not contain a successful HTTPS/runtime health snapshot.',
    staging_evidence_fresh: 'The Step 14 staging evidence is too old and must be repeated.',
    staging_production_unchanged: 'Staging evidence indicates a production change, which Step 15 forbids.',
    runtime_production_eligibility_contract: 'Held nnn runtime does not expose production eligibility contract version 1.',
    held_runtime_consistent: 'Held nnn SHA differs between parity, plan, canary, and staging evidence.',
    v2_fingerprint_current: 'The V2 website changed after the armed plan was created.',
    primary_hostname_current: 'The primary hostname changed after the armed plan was created.',
    rollback_evidence_preserved: 'Legacy rollback evidence is incomplete.',
  };

  const blockers = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([key]) => ({ key, message: labels[key] }));
  const expiresAt = new Date(now.getTime() + settings.ttlMinutes * 60_000);

  const evidenceSnapshot = {
    website_id: website?.id,
    site_key: website?.site_key,
    legacy_import_id: importItem?.id,
    parity_report_id: parityReport?.id,
    cutover_plan_id: plan?.id,
    canary_execution_id: canary?.id,
    staging_edge_run_id: stagingRun?.id,
    legacy_source_commit: importItem?.source_commit,
    legacy_source_fingerprint: importItem?.source_fingerprint,
    held_runtime_commit: plan?.held_runtime_commit,
    v2_fingerprint: parity?.v2_fingerprint,
    primary_hostname: primaryHostname,
    staging_passed_at: stagingRun?.passed_at,
    staging_freshness_window_minutes: settings.stagingMaxAgeMinutes,
    runtime_contracts: runtimeEvidence,
    checks,
    production_traffic_changed: false,
    production_cutover_performed: false,
  };
  const evidenceFingerprint = sha256(JSON.stringify(evidenceSnapshot));

  return {
    contract_version: PRODUCTION_ELIGIBILITY_CONTRACT_VERSION,
    ready: blockers.length === 0,
    status: blockers.length === 0 ? 'production_eligible' : 'blocked',
    checks,
    blockers,
    evidence_snapshot: evidenceSnapshot,
    evidence_fingerprint: evidenceFingerprint,
    primary_hostname: primaryHostname,
    held_runtime_commit: plan?.held_runtime_commit || '',
    legacy_source_commit: importItem?.source_commit || '',
    legacy_source_fingerprint: importItem?.source_fingerprint || '',
    v2_fingerprint: parity?.v2_fingerprint || '',
    rollback_snapshot: plan?.rollback_snapshot || {},
    expires_at: expiresAt,
    staging_age_minutes: Number.isFinite(stagingAge) ? stagingAge : null,
    execution_enabled: false,
    production_traffic_changed: false,
    production_cutover_performed: false,
  };
}

export function evaluateProductionEligibilityRecord({ record, snapshot, now = new Date() }) {
  const expired = new Date(record.expires_at).getTime() <= now.getTime();
  const actionableStatus = ['eligible', 'approved'].includes(record.status);
  const comparisons = {
    status_actionable: actionableStatus,
    record_not_expired: !expired,
    current_evidence_ready: snapshot.ready === true,
    evidence_fingerprint_current: record.evidence_fingerprint === snapshot.evidence_fingerprint,
    legacy_source_commit_current: record.legacy_source_commit === snapshot.legacy_source_commit,
    legacy_source_fingerprint_current: record.legacy_source_fingerprint === snapshot.legacy_source_fingerprint,
    held_runtime_current: record.held_runtime_commit === snapshot.held_runtime_commit,
    v2_fingerprint_current: record.v2_fingerprint === snapshot.v2_fingerprint,
    primary_hostname_current: cleanHost(record.primary_hostname) === cleanHost(snapshot.primary_hostname),
    production_still_unchanged: record.production_traffic_changed === false && record.production_cutover_performed === false,
  };
  const blockers = Object.entries(comparisons).filter(([, passed]) => !passed).map(([key]) => key);
  return {
    current: blockers.length === 0,
    expired,
    comparisons,
    blockers,
    approved: record.status === 'approved' && blockers.length === 0,
    staging_age_minutes: snapshot.staging_age_minutes,
    production_execution_available: false,
    production_traffic_changed: false,
    production_cutover_performed: false,
  };
}
