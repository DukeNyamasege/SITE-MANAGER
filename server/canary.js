import crypto from 'node:crypto';
import express from 'express';
import { query, transaction } from './db.js';
import { requireAdmin, requireAuthenticatedUser } from './session.js';
import { evaluateDualRunParity } from './parity-core.js';
import { evaluateCutoverPlan } from './cutover-core.js';
import {
  CANARY_CONTRACT_VERSION,
  canaryExecutionFingerprint,
  canarySettings,
  completeCanarySimulation,
  rollbackCanarySimulation,
  runCanarySimulation,
} from './canary-executor.js';

const router = express.Router();
router.use(requireAuthenticatedUser, requireAdmin);

async function loadPlanContext(planId) {
  const plan = (await query('SELECT * FROM website_cutover_plans WHERE id = $1 LIMIT 1', [planId])).rows[0] || null;
  if (!plan) return null;
  const website = (await query(
    `SELECT w.*, c.brand_name, c.tagline, c.logo_url, c.navigation, c.colors,
            c.deriv_client_id, c.deriv_scopes, c.deriv_environment, c.configuration_status
       FROM websites w JOIN website_configs c ON c.website_id = w.id
      WHERE w.id = $1 AND w.status <> 'archived' LIMIT 1`,
    [plan.website_id],
  )).rows[0] || null;
  if (!website) return { plan, website: null };
  const importItem = (await query(
    `SELECT * FROM legacy_nnn_site_imports WHERE website_id = $1 AND status = 'assigned' LIMIT 1`,
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
  if (!importItem || !parityReport) return { plan, website, importItem, domains, parityReport, parity: null, evaluation: null };
  const parity = evaluateDualRunParity({ website, config: website, importItem, domains, parityReport });
  const evaluation = evaluateCutoverPlan({ plan, parity });
  return { plan, website, importItem, domains, parityReport, parity, evaluation };
}

async function events(executionId) {
  return (await query(
    `SELECT event_type, details, actor_user_id, created_at
       FROM website_canary_events WHERE execution_id = $1 ORDER BY created_at ASC`,
    [executionId],
  )).rows;
}

function shapeExecution(row, eventRows = []) {
  if (!row) return null;
  return {
    id: row.id,
    plan_id: row.plan_id,
    website_id: row.website_id,
    mode: row.mode,
    status: row.status,
    execution_fingerprint: row.execution_fingerprint,
    primary_hostname: row.primary_hostname,
    held_runtime_commit: row.held_runtime_commit,
    route_snapshot: row.route_snapshot || {},
    rollback_snapshot: row.rollback_snapshot || {},
    health_snapshot: row.health_snapshot || {},
    rollback_window_minutes: Number(row.rollback_window_minutes),
    rollback_deadline: row.rollback_deadline,
    automatic_rollback: Boolean(row.automatic_rollback),
    production_traffic_changed: false,
    production_cutover_performed: false,
    activated_at: row.activated_at,
    health_verified_at: row.health_verified_at,
    passed_at: row.passed_at,
    rolled_back_at: row.rolled_back_at,
    failure_message: row.failure_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
    events: eventRows,
  };
}

async function executionForPlan(planId) {
  return (await query('SELECT * FROM website_canary_executions WHERE plan_id = $1 LIMIT 1', [planId])).rows[0] || null;
}

async function invalidatePlan(planId, reason) {
  await query(
    `UPDATE website_cutover_plans
        SET status = 'invalidated', invalidated_at = COALESCE(invalidated_at, NOW()),
            invalidation_reason = $1, updated_at = NOW()
      WHERE id = $2 AND status = 'armed'`,
    [reason, planId],
  );
}

router.get('/', async (_request, response, next) => {
  try {
    const settings = canarySettings();
    const active = (await query(
      `SELECT e.*, w.name, w.site_key
         FROM website_canary_executions e JOIN websites w ON w.id = e.website_id
        WHERE e.status IN ('activating', 'monitoring') ORDER BY e.created_at DESC LIMIT 1`,
    )).rows[0] || null;
    const recent = (await query(
      `SELECT e.*, w.name, w.site_key
         FROM website_canary_executions e JOIN websites w ON w.id = e.website_id
        ORDER BY e.created_at DESC LIMIT 20`,
    )).rows;
    return response.json({
      contract_version: CANARY_CONTRACT_VERSION,
      mode: settings.mode,
      production_execution_available: false,
      active: active ? { ...shapeExecution(active), website_name: active.name, site_key: active.site_key } : null,
      recent: recent.map(row => ({ ...shapeExecution(row), website_name: row.name, site_key: row.site_key })),
    });
  } catch (error) { return next(error); }
});

router.get('/plan/:planId', async (request, response, next) => {
  try {
    const context = await loadPlanContext(request.params.planId);
    if (!context) return response.status(404).json({ message: 'Cutover plan not found.' });
    const existing = await executionForPlan(context.plan.id);
    return response.json({
      plan_id: context.plan.id,
      plan_status: context.plan.status,
      canary_contract_version: CANARY_CONTRACT_VERSION,
      mode: canarySettings().mode,
      eligible: Boolean(context.plan.status === 'armed' && context.evaluation?.current && !existing),
      evaluation: context.evaluation,
      execution: existing ? shapeExecution(existing, await events(existing.id)) : null,
      production_execution_available: false,
    });
  } catch (error) { return next(error); }
});

router.post('/plan/:planId/execute', async (request, response, next) => {
  const settings = canarySettings();
  if (settings.mode !== 'simulate') {
    return response.status(409).json({ message: 'Canary execution is disabled. Step 13 supports simulation mode only.', mode: settings.mode });
  }

  const executionId = crypto.randomUUID();
  try {
    const context = await loadPlanContext(request.params.planId);
    if (!context) return response.status(404).json({ message: 'Cutover plan not found.' });
    if (!context.website || !context.importItem || !context.parityReport || !context.parity) {
      return response.status(409).json({ message: 'The canary plan is missing migration/parity evidence.' });
    }
    if (context.plan.status !== 'armed' || !context.evaluation?.current) {
      return response.status(409).json({ message: 'Only a current ARMED plan can start a canary simulation.', evaluation: context.evaluation });
    }
    const evidence = context.parityReport.runtime_evidence || {};
    if (Number(evidence.canary_contract_version || 0) !== CANARY_CONTRACT_VERSION || evidence.canary_contract_compatible !== true) {
      return response.status(409).json({ message: 'The held nnn runtime has not passed the Step 13 canary contract handshake.' });
    }
    if (context.plan.runtime_snapshot?.canary_contract_compatible !== true
        || Number(context.plan.runtime_snapshot?.canary_contract_version || 0) !== CANARY_CONTRACT_VERSION) {
      return response.status(409).json({ message: 'This armed plan predates the canary contract. Prepare and arm a fresh plan.' });
    }
    if (await executionForPlan(context.plan.id)) {
      return response.status(409).json({ message: 'This immutable plan has already been used for a canary execution. Prepare a fresh plan to retry.' });
    }
    const globalActive = (await query(
      `SELECT id, website_id FROM website_canary_executions WHERE status IN ('activating', 'monitoring') LIMIT 1`,
    )).rows[0];
    if (globalActive) return response.status(409).json({ message: 'Another canary is already active. Step 13 allows only one site at a time.' });

    const fingerprint = canaryExecutionFingerprint({ executionId, plan: context.plan, siteKey: context.website.site_key });
    const created = await transaction(async client => {
      const result = await client.query(
        `INSERT INTO website_canary_executions
           (id, plan_id, website_id, legacy_import_id, requested_by_user_id, mode, status,
            execution_fingerprint, primary_hostname, held_runtime_commit,
            rollback_snapshot, rollback_window_minutes)
         VALUES ($1,$2,$3,$4,$5,'simulate','activating',$6,$7,$8,$9::jsonb,$10)
         RETURNING *`,
        [executionId, context.plan.id, context.website.id, context.importItem.id, request.authUser.id,
          fingerprint, context.plan.primary_hostname, context.plan.held_runtime_commit,
          JSON.stringify(context.plan.rollback_snapshot || {}), context.plan.rollback_window_minutes],
      );
      await client.query(
        `INSERT INTO website_canary_events (execution_id, actor_user_id, event_type, details)
         VALUES ($1,$2,'requested',$3::jsonb)`,
        [executionId, request.authUser.id, JSON.stringify({ mode: 'simulate', production_traffic_changed: false })],
      );
      return result.rows[0];
    });

    const forceFailure = request.body?.simulate_failure === true;
    const result = await runCanarySimulation({
      executionId,
      plan: context.plan,
      website: context.website,
      importItem: context.importItem,
      parity: context.parity,
      forceFailure,
    });

    if (!result.ok) {
      const rolled = await transaction(async client => {
        const updated = await client.query(
          `UPDATE website_canary_executions
              SET status = 'rolled_back', route_snapshot = $1::jsonb, health_snapshot = $2::jsonb,
                  automatic_rollback = TRUE, activated_at = NOW(), rolled_back_at = NOW(),
                  failure_message = $3, updated_at = NOW()
            WHERE id = $4 RETURNING *`,
          [JSON.stringify(result.routeSnapshot), JSON.stringify(result.healthSnapshot),
            result.rollback.reason, executionId],
        );
        await client.query(
          `INSERT INTO website_canary_events (execution_id, actor_user_id, event_type, details)
           VALUES ($1,$2,'health_failed',$3::jsonb), ($1,$2,'automatic_rollback',$4::jsonb)`,
          [executionId, request.authUser.id, JSON.stringify(result.healthSnapshot), JSON.stringify(result.rollback)],
        );
        return updated.rows[0];
      });
      await invalidatePlan(context.plan.id, 'Step 13 canary health failed and the simulated route was automatically rolled back. Prepare a fresh plan before retrying.');
      return response.status(201).json({
        ok: false,
        automatic_rollback: true,
        execution: shapeExecution(rolled, await events(executionId)),
        production_traffic_changed: false,
        production_cutover_performed: false,
      });
    }

    const rollbackDeadline = new Date(Date.now() + Number(context.plan.rollback_window_minutes) * 60 * 1000);
    const monitoring = await transaction(async client => {
      const updated = await client.query(
        `UPDATE website_canary_executions
            SET status = 'monitoring', route_snapshot = $1::jsonb, health_snapshot = $2::jsonb,
                activated_at = NOW(), health_verified_at = NOW(), rollback_deadline = $3, updated_at = NOW()
          WHERE id = $4 RETURNING *`,
        [JSON.stringify(result.routeSnapshot), JSON.stringify(result.healthSnapshot), rollbackDeadline, executionId],
      );
      await client.query(
        `INSERT INTO website_canary_events (execution_id, actor_user_id, event_type, details)
         VALUES ($1,$2,'activated',$3::jsonb), ($1,$2,'health_passed',$4::jsonb)`,
        [executionId, request.authUser.id, JSON.stringify(result.routeSnapshot), JSON.stringify(result.healthSnapshot)],
      );
      return updated.rows[0];
    });
    return response.status(201).json({
      ok: true,
      automatic_rollback: false,
      execution: shapeExecution(monitoring, await events(executionId)),
      production_traffic_changed: false,
      production_cutover_performed: false,
    });
  } catch (error) {
    if (error?.code === '23505') return response.status(409).json({ message: 'Another canary is active or this plan was already executed.' });
    await query(
      `UPDATE website_canary_executions SET status = 'failed', failure_message = $1, updated_at = NOW() WHERE id = $2 AND status = 'activating'`,
      [String(error?.message || error), executionId],
    ).catch(() => {});
    return next(error);
  }
});

router.post('/executions/:executionId/rollback', async (request, response, next) => {
  try {
    const row = (await query('SELECT * FROM website_canary_executions WHERE id = $1 LIMIT 1', [request.params.executionId])).rows[0];
    if (!row) return response.status(404).json({ message: 'Canary execution not found.' });
    if (row.status !== 'monitoring') return response.status(409).json({ message: `Only a monitoring canary can be rolled back. Current status: ${row.status}.` });
    const rollback = await rollbackCanarySimulation({
      executionId: row.id,
      hostname: row.primary_hostname,
      rollbackSnapshot: row.rollback_snapshot,
      reason: 'Administrator requested the Step 13 canary rollback.',
    });
    const updated = await transaction(async client => {
      const result = await client.query(
        `UPDATE website_canary_executions SET status = 'rolled_back', rolled_back_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status = 'monitoring' RETURNING *`,
        [row.id],
      );
      await client.query(
        `INSERT INTO website_canary_events (execution_id, actor_user_id, event_type, details)
         VALUES ($1,$2,'manual_rollback',$3::jsonb)`,
        [row.id, request.authUser.id, JSON.stringify(rollback)],
      );
      return result.rows[0];
    });
    await invalidatePlan(row.plan_id, 'Step 13 canary was manually rolled back. Prepare a fresh immutable plan before retrying.');
    return response.json({ ok: true, execution: shapeExecution(updated, await events(row.id)), production_traffic_changed: false });
  } catch (error) { return next(error); }
});

router.post('/executions/:executionId/pass', async (request, response, next) => {
  try {
    const settings = canarySettings();
    const row = (await query('SELECT * FROM website_canary_executions WHERE id = $1 LIMIT 1', [request.params.executionId])).rows[0];
    if (!row) return response.status(404).json({ message: 'Canary execution not found.' });
    if (row.status !== 'monitoring') return response.status(409).json({ message: `Only a monitoring canary can pass. Current status: ${row.status}.` });
    const observedSeconds = row.health_verified_at ? Math.floor((Date.now() - new Date(row.health_verified_at).getTime()) / 1000) : 0;
    if (observedSeconds < settings.minObservationSeconds) {
      return response.status(409).json({ message: `Canary observation window has not completed. ${settings.minObservationSeconds - observedSeconds}s remain.`, observed_seconds: observedSeconds });
    }
    const completion = await completeCanarySimulation({ executionId: row.id, hostname: row.primary_hostname, settings });
    const updated = await transaction(async client => {
      const result = await client.query(
        `UPDATE website_canary_executions SET status = 'passed', passed_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status = 'monitoring' RETURNING *`,
        [row.id],
      );
      await client.query(
        `INSERT INTO website_canary_events (execution_id, actor_user_id, event_type, details)
         VALUES ($1,$2,'passed',$3::jsonb)`,
        [row.id, request.authUser.id, JSON.stringify(completion)],
      );
      return result.rows[0];
    });
    return response.json({
      ok: true,
      execution: shapeExecution(updated, await events(row.id)),
      production_traffic_changed: false,
      production_cutover_performed: false,
      message: 'Simulation canary passed. This is evidence only; no production traffic moved.',
    });
  } catch (error) { return next(error); }
});

export default router;
