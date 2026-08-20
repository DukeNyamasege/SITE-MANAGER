import express from 'express';
import { query, transaction } from './db.js';
import { requireAdmin, requireAuthenticatedUser } from './session.js';
import { evaluateDualRunParity } from './parity-core.js';
import { evaluateCutoverPlan } from './cutover-core.js';
import {
  PRODUCTION_ELIGIBILITY_CONTRACT_VERSION,
  buildProductionEligibilitySnapshot,
  evaluateProductionEligibilityRecord,
  productionEligibilitySettings,
} from './production-eligibility-core.js';

const router = express.Router();
router.use(requireAuthenticatedUser, requireAdmin);

async function events(eligibilityId) {
  return (await query(
    `SELECT event_type, details, actor_user_id, created_at
       FROM website_production_eligibility_events
      WHERE eligibility_id = $1 ORDER BY created_at ASC`,
    [eligibilityId],
  )).rows;
}

function shapeRecord(row, eventRows = [], currentEvaluation = null) {
  if (!row) return null;
  return {
    id: row.id,
    website_id: row.website_id,
    legacy_import_id: row.legacy_import_id,
    parity_report_id: row.parity_report_id,
    cutover_plan_id: row.cutover_plan_id,
    canary_execution_id: row.canary_execution_id,
    staging_edge_run_id: row.staging_edge_run_id,
    status: row.status,
    production_eligibility_contract_version: Number(row.production_eligibility_contract_version),
    evidence_fingerprint: row.evidence_fingerprint,
    legacy_source_commit: row.legacy_source_commit,
    legacy_source_fingerprint: row.legacy_source_fingerprint,
    held_runtime_commit: row.held_runtime_commit,
    v2_fingerprint: row.v2_fingerprint,
    primary_hostname: row.primary_hostname,
    checks: row.checks || {},
    evidence_snapshot: row.evidence_snapshot || {},
    rollback_snapshot: row.rollback_snapshot || {},
    eligible_at: row.eligible_at,
    expires_at: row.expires_at,
    approved_at: row.approved_at,
    approved_by_user_id: row.approved_by_user_id,
    invalidated_at: row.invalidated_at,
    invalidated_reason: row.invalidated_reason,
    production_traffic_changed: false,
    production_cutover_performed: false,
    created_at: row.created_at,
    updated_at: row.updated_at,
    current_evaluation: currentEvaluation,
    events: eventRows,
  };
}

async function loadContext(websiteId) {
  const website = (await query(
    `SELECT w.*, c.brand_name, c.tagline, c.logo_url, c.navigation, c.colors,
            c.deriv_client_id, c.deriv_scopes, c.deriv_environment, c.configuration_status
       FROM websites w JOIN website_configs c ON c.website_id = w.id
      WHERE w.id = $1 AND w.status <> 'archived' LIMIT 1`,
    [websiteId],
  )).rows[0] || null;
  if (!website) return null;

  const importItem = (await query(
    `SELECT * FROM legacy_nnn_site_imports
      WHERE website_id = $1 AND status = 'assigned' LIMIT 1`,
    [website.id],
  )).rows[0] || null;
  const domains = (await query(
    `SELECT id, hostname, kind, is_primary, ownership_status, routing_status, ssl_status
       FROM website_domains WHERE website_id = $1 ORDER BY hostname`,
    [website.id],
  )).rows;
  const parityReport = (await query(
    `SELECT * FROM legacy_nnn_parity_reports WHERE website_id = $1 LIMIT 1`,
    [website.id],
  )).rows[0] || null;
  const stagingRun = (await query(
    `SELECT * FROM website_staging_edge_runs
      WHERE website_id = $1 AND status = 'passed'
      ORDER BY passed_at DESC NULLS LAST, created_at DESC LIMIT 1`,
    [website.id],
  )).rows[0] || null;
  const canary = stagingRun
    ? (await query('SELECT * FROM website_canary_executions WHERE id = $1 LIMIT 1', [stagingRun.canary_execution_id])).rows[0] || null
    : null;
  const plan = stagingRun
    ? (await query('SELECT * FROM website_cutover_plans WHERE id = $1 LIMIT 1', [stagingRun.plan_id])).rows[0] || null
    : null;

  if (!importItem || !parityReport || !stagingRun || !canary || !plan) {
    return { website, config: website, importItem, domains, parityReport, stagingRun, canary, plan, parity: null, planEvaluation: null };
  }
  const parity = evaluateDualRunParity({ website, config: website, importItem, domains, parityReport });
  const planEvaluation = evaluateCutoverPlan({ plan, parity });
  return { website, config: website, importItem, domains, parityReport, stagingRun, canary, plan, parity, planEvaluation };
}

function snapshotFor(context) {
  if (!context?.website || !context.importItem || !context.parityReport || !context.stagingRun || !context.canary || !context.plan || !context.parity) {
    return null;
  }
  return buildProductionEligibilitySnapshot({
    website: context.website,
    importItem: context.importItem,
    parityReport: context.parityReport,
    parity: context.parity,
    plan: context.plan,
    planEvaluation: context.planEvaluation,
    canary: context.canary,
    stagingRun: context.stagingRun,
  });
}

async function currentEvaluationFor(row) {
  const context = await loadContext(row.website_id);
  const snapshot = snapshotFor(context);
  if (!snapshot) {
    return {
      current: false,
      expired: new Date(row.expires_at).getTime() <= Date.now(),
      blockers: ['current_evidence_missing'],
      production_execution_available: false,
      production_traffic_changed: false,
      production_cutover_performed: false,
    };
  }
  return evaluateProductionEligibilityRecord({ record: row, snapshot });
}

router.get('/', async (_request, response, next) => {
  try {
    const settings = productionEligibilitySettings();
    const rows = (await query(
      `SELECT e.*, w.name AS website_name, w.site_key
         FROM website_production_eligibility e
         JOIN websites w ON w.id = e.website_id
        ORDER BY e.created_at DESC LIMIT 50`,
    )).rows;
    const records = [];
    for (const row of rows) {
      records.push({
        ...shapeRecord(row, [], await currentEvaluationFor(row)),
        website_name: row.website_name,
        site_key: row.site_key,
      });
    }
    return response.json({
      production_eligibility_contract_version: PRODUCTION_ELIGIBILITY_CONTRACT_VERSION,
      eligibility_ttl_minutes: settings.ttlMinutes,
      staging_max_age_minutes: settings.stagingMaxAgeMinutes,
      production_execution_available: false,
      records,
    });
  } catch (error) { return next(error); }
});

router.get('/:eligibilityId', async (request, response, next) => {
  try {
    const row = (await query(
      'SELECT * FROM website_production_eligibility WHERE id = $1 LIMIT 1',
      [request.params.eligibilityId],
    )).rows[0] || null;
    if (!row) return response.status(404).json({ message: 'Production eligibility record not found.' });
    return response.json({
      record: shapeRecord(row, await events(row.id), await currentEvaluationFor(row)),
      production_execution_available: false,
    });
  } catch (error) { return next(error); }
});

router.post('/website/:websiteId/evaluate', async (request, response, next) => {
  try {
    const context = await loadContext(request.params.websiteId);
    if (!context) return response.status(404).json({ message: 'Website not found.' });
    const snapshot = snapshotFor(context);
    if (!snapshot) {
      return response.status(409).json({
        message: 'Production eligibility requires migration, parity, armed cutover, passed canary, and passed staging-edge evidence.',
        production_execution_available: false,
      });
    }
    if (!snapshot.ready) {
      return response.status(409).json({
        message: 'Website is not production eligible.',
        eligibility: snapshot,
        production_execution_available: false,
      });
    }

    const existing = (await query(
      `SELECT * FROM website_production_eligibility
        WHERE website_id = $1 AND status IN ('eligible', 'approved')
        ORDER BY created_at DESC LIMIT 1`,
      [context.website.id],
    )).rows[0] || null;
    if (existing) {
      const evaluation = evaluateProductionEligibilityRecord({ record: existing, snapshot });
      if (evaluation.current && existing.evidence_fingerprint === snapshot.evidence_fingerprint) {
        return response.status(200).json({
          idempotent: true,
          record: shapeRecord(existing, await events(existing.id), evaluation),
          production_execution_available: false,
        });
      }
    }

    const created = await transaction(async client => {
      await client.query(
        `UPDATE website_production_eligibility
            SET status = 'invalidated', invalidated_at = NOW(),
                invalidated_reason = 'Current evidence changed; a new Step 15 record was created.', updated_at = NOW()
          WHERE website_id = $1 AND status IN ('eligible', 'approved')`,
        [context.website.id],
      );
      const inserted = await client.query(
        `INSERT INTO website_production_eligibility
           (website_id, legacy_import_id, parity_report_id, cutover_plan_id, canary_execution_id,
            staging_edge_run_id, created_by_user_id, status, production_eligibility_contract_version,
            evidence_fingerprint, legacy_source_commit, legacy_source_fingerprint,
            held_runtime_commit, v2_fingerprint, primary_hostname, checks, evidence_snapshot,
            rollback_snapshot, eligible_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'eligible',$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,NOW(),$18)
         RETURNING *`,
        [context.website.id, context.importItem.id, context.parityReport.id, context.plan.id, context.canary.id,
          context.stagingRun.id, request.authUser.id, PRODUCTION_ELIGIBILITY_CONTRACT_VERSION,
          snapshot.evidence_fingerprint, snapshot.legacy_source_commit, snapshot.legacy_source_fingerprint,
          snapshot.held_runtime_commit, snapshot.v2_fingerprint, snapshot.primary_hostname,
          JSON.stringify(snapshot.checks), JSON.stringify(snapshot.evidence_snapshot),
          JSON.stringify(snapshot.rollback_snapshot), snapshot.expires_at],
      );
      await client.query(
        `INSERT INTO website_production_eligibility_events (eligibility_id, actor_user_id, event_type, details)
         VALUES ($1,$2,'eligibility_created',$3::jsonb)`,
        [inserted.rows[0].id, request.authUser.id, JSON.stringify({
          evidence_fingerprint: snapshot.evidence_fingerprint,
          held_runtime_commit: snapshot.held_runtime_commit,
          staging_edge_run_id: context.stagingRun.id,
          production_execution_available: false,
        })],
      );
      return inserted.rows[0];
    });
    return response.status(201).json({
      record: shapeRecord(created, await events(created.id), evaluateProductionEligibilityRecord({ record: created, snapshot })),
      production_execution_available: false,
    });
  } catch (error) {
    if (error?.code === '23505') return response.status(409).json({ message: 'An actionable production eligibility record already exists for this site.' });
    return next(error);
  }
});

router.post('/:eligibilityId/approve', async (request, response, next) => {
  try {
    const row = (await query(
      'SELECT * FROM website_production_eligibility WHERE id = $1 LIMIT 1',
      [request.params.eligibilityId],
    )).rows[0] || null;
    if (!row) return response.status(404).json({ message: 'Production eligibility record not found.' });
    const context = await loadContext(row.website_id);
    const snapshot = snapshotFor(context);
    const evaluation = snapshot
      ? evaluateProductionEligibilityRecord({ record: row, snapshot })
      : { current: false, blockers: ['current_evidence_missing'] };
    if (!evaluation.current) {
      if (['eligible', 'approved'].includes(row.status)) {
        await transaction(async client => {
          await client.query(
            `UPDATE website_production_eligibility
                SET status = 'invalidated', invalidated_at = NOW(),
                    invalidated_reason = $1, updated_at = NOW()
              WHERE id = $2`,
            [`Approval rejected because current evidence changed: ${(evaluation.blockers || []).join(', ')}`, row.id],
          );
          await client.query(
            `INSERT INTO website_production_eligibility_events (eligibility_id, actor_user_id, event_type, details)
             VALUES ($1,$2,'approval_rejected',$3::jsonb)`,
            [row.id, request.authUser.id, JSON.stringify({ blockers: evaluation.blockers || [] })],
          );
        });
      }
      return response.status(409).json({
        message: 'Production eligibility evidence is no longer current. Repeat the required rehearsal and create a new eligibility record.',
        current_evaluation: evaluation,
        production_execution_available: false,
      });
    }
    if (row.status === 'approved') {
      return response.json({ idempotent: true, record: shapeRecord(row, await events(row.id), evaluation), production_execution_available: false });
    }
    if (row.status !== 'eligible') {
      return response.status(409).json({ message: `Only an eligible record can be approved. Current status: ${row.status}.` });
    }

    const approved = await transaction(async client => {
      const result = await client.query(
        `UPDATE website_production_eligibility
            SET status = 'approved', approved_by_user_id = $1, approved_at = NOW(), updated_at = NOW()
          WHERE id = $2 AND status = 'eligible' RETURNING *`,
        [request.authUser.id, row.id],
      );
      await client.query(
        `INSERT INTO website_production_eligibility_events (eligibility_id, actor_user_id, event_type, details)
         VALUES ($1,$2,'final_approval_granted',$3::jsonb)`,
        [row.id, request.authUser.id, JSON.stringify({
          production_execution_available: false,
          production_traffic_changed: false,
          production_cutover_performed: false,
        })],
      );
      return result.rows[0];
    });
    return response.json({
      record: shapeRecord(approved, await events(approved.id), await currentEvaluationFor(approved)),
      production_execution_available: false,
    });
  } catch (error) { return next(error); }
});

router.post('/:eligibilityId/revoke', async (request, response, next) => {
  try {
    const row = (await query(
      'SELECT * FROM website_production_eligibility WHERE id = $1 LIMIT 1',
      [request.params.eligibilityId],
    )).rows[0] || null;
    if (!row) return response.status(404).json({ message: 'Production eligibility record not found.' });
    if (!['eligible', 'approved'].includes(row.status)) {
      return response.status(409).json({ message: `This record is already non-actionable: ${row.status}.` });
    }
    const reason = String(request.body?.reason || 'Administrator revoked production eligibility.').trim().slice(0, 500);
    const revoked = await transaction(async client => {
      const result = await client.query(
        `UPDATE website_production_eligibility
            SET status = 'revoked', invalidated_at = NOW(), invalidated_reason = $1, updated_at = NOW()
          WHERE id = $2 RETURNING *`,
        [reason, row.id],
      );
      await client.query(
        `INSERT INTO website_production_eligibility_events (eligibility_id, actor_user_id, event_type, details)
         VALUES ($1,$2,'eligibility_revoked',$3::jsonb)`,
        [row.id, request.authUser.id, JSON.stringify({ reason })],
      );
      return result.rows[0];
    });
    return response.json({ record: shapeRecord(revoked, await events(revoked.id), await currentEvaluationFor(revoked)), production_execution_available: false });
  } catch (error) { return next(error); }
});

router.post('/:eligibilityId/execute', async (request, response, next) => {
  try {
    const row = (await query(
      'SELECT * FROM website_production_eligibility WHERE id = $1 LIMIT 1',
      [request.params.eligibilityId],
    )).rows[0] || null;
    if (!row) return response.status(404).json({ message: 'Production eligibility record not found.' });
    await query(
      `INSERT INTO website_production_eligibility_events (eligibility_id, actor_user_id, event_type, details)
       VALUES ($1,$2,'execution_blocked',$3::jsonb)`,
      [row.id, request.authUser.id, JSON.stringify({
        step: 15,
        reason: 'Production cutover execution is intentionally unavailable in Step 15.',
        production_traffic_changed: false,
        production_cutover_performed: false,
      })],
    );
    return response.status(409).json({
      message: 'Production cutover execution is disabled in Step 15. Final approval records eligibility only; it does not move traffic.',
      production_execution_available: false,
      production_traffic_changed: false,
      production_cutover_performed: false,
    });
  } catch (error) { return next(error); }
});

export default router;
