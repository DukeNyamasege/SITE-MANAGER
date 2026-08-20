import express from 'express';
import { query, transaction } from './db.js';
import { requireAdmin, requireAuthenticatedUser } from './session.js';
import { evaluateDualRunParity } from './parity-core.js';
import {
  CUTOVER_CONTRACT_VERSION,
  CUTOVER_PLAN_VERSION,
  buildCutoverSnapshot,
  evaluateCutoverPlan,
} from './cutover-core.js';

const router = express.Router();
router.use(requireAuthenticatedUser, requireAdmin);

async function loadContext(websiteId) {
  const websiteResult = await query(
    `SELECT w.id, w.owner_user_id, w.name, w.site_key, w.source, w.status,
            w.primary_domain, w.domain_status, w.deployment_status, w.preview_approved_at,
            c.brand_name, c.tagline, c.logo_url, c.navigation, c.colors, c.deriv_client_id,
            c.deriv_scopes, c.deriv_environment, c.configuration_status
       FROM websites w
       JOIN website_configs c ON c.website_id = w.id
      WHERE w.id = $1 AND w.status <> 'archived'
      LIMIT 1`,
    [websiteId],
  );
  const website = websiteResult.rows[0];
  if (!website) return null;

  const importResult = await query(
    `SELECT * FROM legacy_nnn_site_imports
      WHERE website_id = $1 AND status = 'assigned'
      LIMIT 1`,
    [website.id],
  );
  const importItem = importResult.rows[0] || null;
  const domains = (await query(
    `SELECT id, hostname, kind, is_primary, ownership_status, routing_status, ssl_status
       FROM website_domains WHERE website_id = $1 ORDER BY hostname`,
    [website.id],
  )).rows;
  const parityReport = (await query(
    `SELECT * FROM legacy_nnn_parity_reports WHERE website_id = $1 LIMIT 1`,
    [website.id],
  )).rows[0] || null;

  return { website, config: website, importItem, domains, parityReport };
}

function currentParity(context) {
  if (!context?.importItem || context.website.source !== 'migrated') return null;
  return evaluateDualRunParity(context);
}

function shapePlan(row, evaluation = null, events = []) {
  return {
    id: row.id,
    website_id: row.website_id,
    legacy_import_id: row.legacy_import_id,
    parity_report_id: row.parity_report_id,
    plan_version: Number(row.plan_version),
    cutover_contract_version: Number(row.cutover_contract_version),
    status: row.status,
    primary_hostname: row.primary_hostname,
    legacy_source_commit: row.legacy_source_commit,
    legacy_source_fingerprint: row.legacy_source_fingerprint,
    held_runtime_commit: row.held_runtime_commit,
    v2_fingerprint: row.v2_fingerprint,
    parity_snapshot: row.parity_snapshot || {},
    runtime_snapshot: row.runtime_snapshot || {},
    rollback_snapshot: row.rollback_snapshot || {},
    preflight_snapshot: row.preflight_snapshot || {},
    plan_fingerprint: row.plan_fingerprint,
    rollback_window_minutes: Number(row.rollback_window_minutes),
    expires_at: row.expires_at,
    armed_at: row.armed_at,
    invalidated_at: row.invalidated_at,
    invalidation_reason: row.invalidation_reason,
    cancelled_at: row.cancelled_at,
    production_cutover_performed: false,
    created_at: row.created_at,
    updated_at: row.updated_at,
    current_evaluation: evaluation,
    events,
  };
}

async function planEvents(planId) {
  return (await query(
    `SELECT event_type, details, actor_user_id, created_at
       FROM website_cutover_events WHERE plan_id = $1 ORDER BY created_at ASC`,
    [planId],
  )).rows;
}

async function refreshPlan(plan, parity) {
  if (!['prepared', 'armed'].includes(plan.status)) return { plan, evaluation: evaluateCutoverPlan({ plan, parity }) };
  const evaluation = evaluateCutoverPlan({ plan, parity });
  if (evaluation.current) return { plan, evaluation };

  const nextStatus = evaluation.expired ? 'expired' : 'invalidated';
  const reason = evaluation.expired
    ? 'The immutable cutover plan expired before execution.'
    : `Current evidence no longer matches the immutable plan: ${evaluation.blockers.join(', ')}.`;
  const result = await transaction(async client => {
    const updated = await client.query(
      `UPDATE website_cutover_plans
          SET status = $1,
              invalidated_at = CASE WHEN $1 = 'invalidated' THEN NOW() ELSE invalidated_at END,
              invalidation_reason = $2,
              updated_at = NOW()
        WHERE id = $3 AND status IN ('prepared', 'armed')
        RETURNING *`,
      [nextStatus, reason, plan.id],
    );
    const row = updated.rows[0] || plan;
    if (updated.rows[0]) {
      await client.query(
        `INSERT INTO website_cutover_events (plan_id, event_type, details)
         VALUES ($1, $2, $3::jsonb)`,
        [plan.id, nextStatus === 'expired' ? 'expired' : 'invalidated', JSON.stringify({ reason, blockers: evaluation.blockers })],
      );
    }
    return row;
  });
  return { plan: result, evaluation: evaluateCutoverPlan({ plan: result, parity }) };
}

async function planWithCurrentState(planId) {
  const row = (await query('SELECT * FROM website_cutover_plans WHERE id = $1 LIMIT 1', [planId])).rows[0];
  if (!row) return null;
  const context = await loadContext(row.website_id);
  if (!context?.importItem) return { plan: row, context, parity: null, evaluation: null };
  const parity = currentParity(context);
  const refreshed = await refreshPlan(row, parity);
  return { plan: refreshed.plan, context, parity, evaluation: refreshed.evaluation };
}

router.get('/', async (_request, response, next) => {
  try {
    const websiteIds = (await query(
      `SELECT w.id
         FROM websites w
         JOIN legacy_nnn_site_imports i ON i.website_id = w.id AND i.status = 'assigned'
        WHERE w.source = 'migrated' AND w.status <> 'archived'
        ORDER BY w.name ASC`,
    )).rows;
    const sites = [];
    for (const item of websiteIds) {
      const context = await loadContext(item.id);
      const parity = currentParity(context);
      const openPlanRow = (await query(
        `SELECT * FROM website_cutover_plans
          WHERE website_id = $1 AND status IN ('prepared', 'armed')
          ORDER BY created_at DESC LIMIT 1`,
        [item.id],
      )).rows[0] || null;
      let openPlan = null;
      if (openPlanRow && parity) {
        const refreshed = await refreshPlan(openPlanRow, parity);
        openPlan = refreshed.plan.status === 'prepared' || refreshed.plan.status === 'armed'
          ? shapePlan(refreshed.plan, refreshed.evaluation)
          : null;
      }
      sites.push({
        website: {
          id: context.website.id,
          name: context.website.name,
          site_key: context.website.site_key,
          primary_domain: context.website.primary_domain,
          deployment_status: context.website.deployment_status,
        },
        parity: parity ? { status: parity.status, cutover_ready: parity.cutover_ready, blockers: parity.blockers } : null,
        open_plan: openPlan,
      });
    }
    return response.json({
      cutover_contract_version: CUTOVER_CONTRACT_VERSION,
      execution_enabled: false,
      sites,
    });
  } catch (error) { return next(error); }
});

router.get('/plans/:planId', async (request, response, next) => {
  try {
    const state = await planWithCurrentState(request.params.planId);
    if (!state) return response.status(404).json({ message: 'Cutover plan not found.' });
    return response.json({
      plan: shapePlan(state.plan, state.evaluation, await planEvents(state.plan.id)),
      parity: state.parity,
      execution_enabled: false,
    });
  } catch (error) { return next(error); }
});

router.post('/plans/:planId/arm', async (request, response, next) => {
  try {
    const state = await planWithCurrentState(request.params.planId);
    if (!state) return response.status(404).json({ message: 'Cutover plan not found.' });
    if (state.plan.status !== 'prepared') {
      return response.status(409).json({ message: `Only a prepared plan can be armed. Current status: ${state.plan.status}.`, plan: shapePlan(state.plan, state.evaluation) });
    }
    if (!state.evaluation?.current) {
      return response.status(409).json({ message: 'The cutover plan no longer matches current evidence.', plan: shapePlan(state.plan, state.evaluation) });
    }

    const armed = await transaction(async client => {
      const result = await client.query(
        `UPDATE website_cutover_plans
            SET status = 'armed', armed_by_user_id = $1, armed_at = NOW(), updated_at = NOW()
          WHERE id = $2 AND status = 'prepared'
          RETURNING *`,
        [request.authUser.id, state.plan.id],
      );
      if (!result.rows[0]) throw new Error('The cutover plan changed while it was being armed.');
      await client.query(
        `INSERT INTO website_cutover_events (plan_id, actor_user_id, event_type, details)
         VALUES ($1, $2, 'armed', $3::jsonb)`,
        [state.plan.id, request.authUser.id, JSON.stringify({ execution_enabled: false, production_cutover_performed: false })],
      );
      return result.rows[0];
    });
    return response.json({
      ok: true,
      plan: shapePlan(armed, evaluateCutoverPlan({ plan: armed, parity: state.parity }), await planEvents(armed.id)),
      message: 'Cutover plan armed. Production execution remains disabled in Step 12.',
      execution_enabled: false,
    });
  } catch (error) { return next(error); }
});

router.post('/plans/:planId/cancel', async (request, response, next) => {
  try {
    const row = (await query('SELECT * FROM website_cutover_plans WHERE id = $1 LIMIT 1', [request.params.planId])).rows[0];
    if (!row) return response.status(404).json({ message: 'Cutover plan not found.' });
    if (!['prepared', 'armed'].includes(row.status)) return response.status(409).json({ message: `Plan is already ${row.status}.` });
    const cancelled = await transaction(async client => {
      const result = await client.query(
        `UPDATE website_cutover_plans SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status IN ('prepared', 'armed') RETURNING *`,
        [row.id],
      );
      await client.query(
        `INSERT INTO website_cutover_events (plan_id, actor_user_id, event_type, details)
         VALUES ($1, $2, 'cancelled', $3::jsonb)`,
        [row.id, request.authUser.id, JSON.stringify({ production_cutover_performed: false })],
      );
      return result.rows[0];
    });
    return response.json({ ok: true, plan: shapePlan(cancelled), execution_enabled: false });
  } catch (error) { return next(error); }
});

router.post('/plans/:planId/execute', async (request, response, next) => {
  try {
    const row = (await query('SELECT * FROM website_cutover_plans WHERE id = $1 LIMIT 1', [request.params.planId])).rows[0];
    if (!row) return response.status(404).json({ message: 'Cutover plan not found.' });
    await query(
      `INSERT INTO website_cutover_events (plan_id, actor_user_id, event_type, details)
       VALUES ($1, $2, 'execution_blocked', $3::jsonb)`,
      [row.id, request.authUser.id, JSON.stringify({ step: 12, reason: 'production execution contract not installed' })],
    );
    return response.status(409).json({
      message: 'Production cutover execution is intentionally disabled in Step 12. Arming a plan does not move traffic.',
      execution_enabled: false,
      production_cutover_performed: false,
    });
  } catch (error) { return next(error); }
});

router.get('/:websiteId', async (request, response, next) => {
  try {
    const context = await loadContext(request.params.websiteId);
    if (!context) return response.status(404).json({ message: 'Website not found.' });
    const parity = currentParity(context);
    if (!parity) return response.status(409).json({ message: 'Cutover orchestration only applies to assigned migrated nnn sites.' });
    const plans = (await query(
      `SELECT * FROM website_cutover_plans WHERE website_id = $1 ORDER BY created_at DESC LIMIT 25`,
      [context.website.id],
    )).rows;
    const shaped = [];
    for (const plan of plans) {
      const refreshed = await refreshPlan(plan, parity);
      shaped.push(shapePlan(refreshed.plan, refreshed.evaluation));
    }
    return response.json({
      website: {
        id: context.website.id,
        name: context.website.name,
        site_key: context.website.site_key,
        primary_domain: context.website.primary_domain,
        deployment_status: context.website.deployment_status,
      },
      parity,
      plans: shaped,
      execution_enabled: false,
    });
  } catch (error) { return next(error); }
});

router.post('/:websiteId/prepare', async (request, response, next) => {
  try {
    const context = await loadContext(request.params.websiteId);
    if (!context) return response.status(404).json({ message: 'Website not found.' });
    const parity = currentParity(context);
    if (!parity || !parity.cutover_ready) {
      return response.status(409).json({ message: 'A cutover plan can only be prepared from current PARITY READY evidence.', parity });
    }
    if (context.parityReport?.runtime_evidence?.cutover_contract_compatible !== true
        || Number(context.parityReport?.runtime_evidence?.cutover_contract_version || 0) !== CUTOVER_CONTRACT_VERSION) {
      return response.status(409).json({ message: 'The held nnn runtime has not passed the Step 12 cutover contract handshake.' });
    }

    const existing = (await query(
      `SELECT * FROM website_cutover_plans WHERE website_id = $1 AND status IN ('prepared', 'armed') ORDER BY created_at DESC LIMIT 1`,
      [context.website.id],
    )).rows[0];
    if (existing) {
      const refreshed = await refreshPlan(existing, parity);
      if (['prepared', 'armed'].includes(refreshed.plan.status)) {
        return response.status(409).json({ message: 'This website already has an open cutover plan. Cancel or invalidate it before creating another.', plan: shapePlan(refreshed.plan, refreshed.evaluation) });
      }
    }

    const snapshot = buildCutoverSnapshot({
      context,
      parity,
      rollbackWindowMinutes: request.body?.rollback_window_minutes,
    });
    if (!snapshot.primaryHostname) return response.status(409).json({ message: 'A primary hostname is required before creating a cutover plan.' });
    if (!snapshot.preflightSnapshot.routing_target_configured) {
      return response.status(409).json({ message: 'A VPS routing target must be configured before creating a cutover plan.' });
    }

    const created = await transaction(async client => {
      const result = await client.query(
        `INSERT INTO website_cutover_plans
           (website_id, legacy_import_id, parity_report_id, created_by_user_id,
            plan_version, cutover_contract_version, primary_hostname,
            legacy_source_commit, legacy_source_fingerprint, held_runtime_commit,
            v2_fingerprint, parity_snapshot, runtime_snapshot, rollback_snapshot,
            preflight_snapshot, plan_fingerprint, rollback_window_minutes, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18)
         RETURNING *`,
        [
          context.website.id,
          context.importItem.id,
          context.parityReport.id,
          request.authUser.id,
          CUTOVER_PLAN_VERSION,
          CUTOVER_CONTRACT_VERSION,
          snapshot.primaryHostname,
          snapshot.legacySourceCommit,
          snapshot.legacySourceFingerprint,
          snapshot.heldRuntimeCommit,
          snapshot.v2Fingerprint,
          JSON.stringify(snapshot.paritySnapshot),
          JSON.stringify(snapshot.runtimeSnapshot),
          JSON.stringify(snapshot.rollbackSnapshot),
          JSON.stringify(snapshot.preflightSnapshot),
          snapshot.planFingerprint,
          snapshot.rollbackWindowMinutes,
          snapshot.expiresAt,
        ],
      );
      await client.query(
        `INSERT INTO website_cutover_events (plan_id, actor_user_id, event_type, details)
         VALUES ($1, $2, 'prepared', $3::jsonb)`,
        [result.rows[0].id, request.authUser.id, JSON.stringify({ execution_enabled: false, production_cutover_performed: false })],
      );
      return result.rows[0];
    });
    const evaluation = evaluateCutoverPlan({ plan: created, parity });
    return response.status(201).json({
      ok: true,
      plan: shapePlan(created, evaluation, await planEvents(created.id)),
      execution_enabled: false,
      message: 'Immutable cutover plan prepared. An administrator may arm it, but Step 12 still cannot move production traffic.',
    });
  } catch (error) {
    if (error?.code === '23505') return response.status(409).json({ message: 'An open or identical cutover plan already exists.' });
    return next(error);
  }
});

export default router;
