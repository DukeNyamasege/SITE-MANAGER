import express from 'express';
import { query, transaction } from './db.js';
import { requireAdmin, requireAuthenticatedUser } from './session.js';
import { hashToken, randomToken } from './security.js';
import { evaluateDualRunParity } from './parity-core.js';
import { evaluateCutoverPlan } from './cutover-core.js';
import {
  STAGING_EDGE_CONTRACT_VERSION,
  applyStagingEdge,
  breakStagingEdgeForDrill,
  checkStagingEdgeHealth,
  deactivateStagingEdge,
  stagingEdgeSettings,
} from './staging-edge-executor.js';
import { monitorStagingEdgeRuns } from './staging-edge-monitor.js';

const router = express.Router();
router.use(requireAuthenticatedUser, requireAdmin);

async function events(runId) {
  return (await query(
    `SELECT event_type, details, actor_user_id, created_at
       FROM website_staging_edge_events WHERE run_id = $1 ORDER BY created_at ASC`,
    [runId],
  )).rows;
}

function shapeRun(row, eventRows = []) {
  if (!row) return null;
  return {
    id: row.id,
    canary_execution_id: row.canary_execution_id,
    plan_id: row.plan_id,
    website_id: row.website_id,
    mode: row.mode,
    status: row.status,
    staging_hostname: row.staging_hostname,
    held_runtime_commit: row.held_runtime_commit,
    route_snapshot: row.route_snapshot || {},
    rollback_snapshot: row.rollback_snapshot || {},
    health_snapshot: row.health_snapshot || {},
    monitor_snapshot: row.monitor_snapshot || {},
    route_path: row.route_path,
    health_url: row.health_url,
    rollback_deadline: row.rollback_deadline,
    last_healthy_at: row.last_healthy_at,
    consecutive_failures: Number(row.consecutive_failures || 0),
    automatic_rollback: Boolean(row.automatic_rollback),
    staging_traffic_changed: Boolean(row.staging_traffic_changed),
    production_traffic_changed: false,
    production_cutover_performed: false,
    activated_at: row.activated_at,
    recovered_at: row.recovered_at,
    passed_at: row.passed_at,
    rolled_back_at: row.rolled_back_at,
    failure_message: row.failure_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
    events: eventRows,
  };
}

async function loadContext(canaryExecutionId) {
  const canary = (await query(
    `SELECT e.*, p.status AS plan_status, p.primary_hostname AS plan_primary_hostname,
            p.held_runtime_commit AS plan_held_runtime_commit, p.plan_fingerprint,
            p.runtime_snapshot, p.rollback_snapshot, p.rollback_window_minutes,
            p.expires_at AS plan_expires_at
       FROM website_canary_executions e
       JOIN website_cutover_plans p ON p.id = e.plan_id
      WHERE e.id = $1 LIMIT 1`,
    [canaryExecutionId],
  )).rows[0] || null;
  if (!canary) return null;
  const website = (await query(
    `SELECT w.*, c.brand_name, c.tagline, c.logo_url, c.navigation, c.colors,
            c.deriv_client_id, c.deriv_scopes, c.deriv_environment, c.configuration_status
       FROM websites w JOIN website_configs c ON c.website_id = w.id
      WHERE w.id = $1 AND w.status <> 'archived' LIMIT 1`,
    [canary.website_id],
  )).rows[0] || null;
  if (!website) return { canary, website: null };
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
  const plan = (await query('SELECT * FROM website_cutover_plans WHERE id = $1 LIMIT 1', [canary.plan_id])).rows[0] || null;
  if (!importItem || !parityReport || !plan) return { canary, website, importItem, domains, parityReport, plan, parity: null, evaluation: null };
  const parity = evaluateDualRunParity({ website, config: website, importItem, domains, parityReport });
  const evaluation = evaluateCutoverPlan({ plan, parity });
  return { canary, website, importItem, domains, parityReport, plan, parity, evaluation };
}

router.get('/', async (_request, response, next) => {
  try {
    const settings = stagingEdgeSettings();
    const active = (await query(
      `SELECT r.*, w.name, w.site_key
         FROM website_staging_edge_runs r JOIN websites w ON w.id = r.website_id
        WHERE r.status IN ('applying', 'monitoring') ORDER BY r.created_at DESC LIMIT 1`,
    )).rows[0] || null;
    const recent = (await query(
      `SELECT r.*, w.name, w.site_key
         FROM website_staging_edge_runs r JOIN websites w ON w.id = r.website_id
        ORDER BY r.created_at DESC LIMIT 20`,
    )).rows;
    return response.json({
      staging_edge_contract_version: STAGING_EDGE_CONTRACT_VERSION,
      mode: settings.mode,
      environment: settings.environment,
      approved: settings.approved,
      staging_hostname: settings.hostname,
      production_execution_available: false,
      active: active ? { ...shapeRun(active), website_name: active.name, site_key: active.site_key } : null,
      recent: recent.map(row => ({ ...shapeRun(row), website_name: row.name, site_key: row.site_key })),
    });
  } catch (error) { return next(error); }
});

router.get('/runs/:runId', async (request, response, next) => {
  try {
    const row = (await query('SELECT * FROM website_staging_edge_runs WHERE id = $1 LIMIT 1', [request.params.runId])).rows[0];
    if (!row) return response.status(404).json({ message: 'Staging-edge run not found.' });
    return response.json({ run: shapeRun(row, await events(row.id)), production_execution_available: false });
  } catch (error) { return next(error); }
});

router.post('/canary/:executionId/start', async (request, response, next) => {
  const settings = stagingEdgeSettings();
  if (settings.mode !== 'staging') {
    return response.status(409).json({
      message: 'Staging-edge execution is disabled. Step 14 requires an explicitly approved staging environment.',
      mode: settings.mode,
    });
  }

  const runtimeToken = randomToken(32);
  let runId = '';
  try {
    const context = await loadContext(request.params.executionId);
    if (!context) return response.status(404).json({ message: 'Passed canary execution not found.' });
    if (!context.website || !context.importItem || !context.parityReport || !context.plan || !context.parity) {
      return response.status(409).json({ message: 'Staging edge is missing migration/parity/cutover evidence.' });
    }
    if (context.canary.status !== 'passed') {
      return response.status(409).json({ message: `Step 14 requires a PASSED Step 13 canary. Current status: ${context.canary.status}.` });
    }
    if (context.plan.status !== 'armed' || !context.evaluation?.current) {
      return response.status(409).json({ message: 'The cutover plan is no longer current and armed.', evaluation: context.evaluation });
    }
    if (new Date(context.plan.expires_at).getTime() <= Date.now()) {
      return response.status(409).json({ message: 'The immutable cutover plan expired before staging-edge execution.' });
    }
    const evidence = context.parityReport.runtime_evidence || {};
    if (Number(evidence.staging_edge_contract_version || 0) !== STAGING_EDGE_CONTRACT_VERSION
        || evidence.staging_edge_contract_compatible !== true) {
      return response.status(409).json({ message: 'The held nnn runtime has not passed the Step 14 staging-edge contract handshake.' });
    }
    if (Number(context.plan.runtime_snapshot?.staging_edge_contract_version || 0) !== STAGING_EDGE_CONTRACT_VERSION
        || context.plan.runtime_snapshot?.staging_edge_contract_compatible !== true) {
      return response.status(409).json({ message: 'This armed plan predates the Step 14 staging-edge contract. Prepare, arm and canary a fresh plan.' });
    }
    if (settings.hostname === String(context.plan.primary_hostname || '').toLowerCase()) {
      return response.status(409).json({ message: 'The staging hostname must never equal the customer production hostname.' });
    }
    const active = (await query(
      `SELECT id FROM website_staging_edge_runs WHERE status IN ('applying', 'monitoring') LIMIT 1`,
    )).rows[0];
    if (active) return response.status(409).json({ message: 'Another real staging-edge run is already active.' });

    const tokenExpiresAt = new Date(Date.now() + settings.tokenTtlMinutes * 60 * 1000);
    const created = await transaction(async client => {
      const result = await client.query(
        `INSERT INTO website_staging_edge_runs
           (canary_execution_id, plan_id, website_id, legacy_import_id, requested_by_user_id,
            status, staging_hostname, held_runtime_commit, runtime_token_hash,
            runtime_token_expires_at, rollback_snapshot)
         VALUES ($1,$2,$3,$4,$5,'applying',$6,$7,$8,$9,$10::jsonb)
         RETURNING *`,
        [context.canary.id, context.plan.id, context.website.id, context.importItem.id,
          request.authUser.id, settings.hostname, context.plan.held_runtime_commit,
          hashToken(runtimeToken), tokenExpiresAt, JSON.stringify(context.plan.rollback_snapshot || {})],
      );
      await client.query(
        `INSERT INTO website_staging_edge_events (run_id, actor_user_id, event_type, details)
         VALUES ($1,$2,'requested',$3::jsonb)`,
        [result.rows[0].id, request.authUser.id, JSON.stringify({
          staging_hostname: settings.hostname,
          production_traffic_changed: false,
          production_cutover_performed: false,
        })],
      );
      return result.rows[0];
    });
    runId = created.id;

    const applied = await applyStagingEdge({
      runId,
      runtimeToken,
      expectedHeldCommit: context.plan.held_runtime_commit,
      customerHostname: context.plan.primary_hostname,
    });
    const health = await checkStagingEdgeHealth({
      runId,
      expectedSiteKey: context.website.site_key,
      expectedHeldCommit: context.plan.held_runtime_commit,
    });

    if (!health.ok) {
      const rollback = await deactivateStagingEdge({ reason: 'Initial Step 14 HTTPS health criteria failed.' });
      const rolled = await transaction(async client => {
        const result = await client.query(
          `UPDATE website_staging_edge_runs
              SET status = 'rolled_back', automatic_rollback = TRUE,
                  staging_traffic_changed = FALSE, route_snapshot = $1::jsonb,
                  health_snapshot = $2::jsonb, monitor_snapshot = $3::jsonb,
                  route_path = $4, health_url = $5, activated_at = NOW(),
                  rolled_back_at = NOW(), failure_message = $6, updated_at = NOW()
            WHERE id = $7 RETURNING *`,
          [JSON.stringify(applied.routeSnapshot), JSON.stringify(health), JSON.stringify({ rollback }),
            applied.settings.caddyfile, applied.healthUrl,
            `Initial staging-edge health failed: ${health.failed.join(', ')}`, runId],
        );
        await client.query(
          `INSERT INTO website_staging_edge_events (run_id, actor_user_id, event_type, details)
           VALUES ($1,$2,'caddy_validated',$3::jsonb), ($1,$2,'caddy_reloaded',$4::jsonb),
                  ($1,$2,'health_failed',$5::jsonb), ($1,$2,'automatic_rollback',$6::jsonb)`,
          [runId, request.authUser.id, JSON.stringify({ caddyfile: applied.settings.caddyfile }),
            JSON.stringify(applied.routeSnapshot), JSON.stringify(health), JSON.stringify(rollback)],
        );
        return result.rows[0];
      });
      return response.status(201).json({ ok: false, automatic_rollback: true, run: shapeRun(rolled, await events(runId)) });
    }

    const rollbackDeadline = new Date(Date.now() + Number(context.plan.rollback_window_minutes) * 60 * 1000);
    const monitoring = await transaction(async client => {
      const result = await client.query(
        `UPDATE website_staging_edge_runs
            SET status = 'monitoring', staging_traffic_changed = TRUE,
                route_snapshot = $1::jsonb, health_snapshot = $2::jsonb,
                monitor_snapshot = $3::jsonb, route_path = $4, health_url = $5,
                rollback_deadline = $6, last_healthy_at = NOW(), consecutive_failures = 0,
                activated_at = NOW(), updated_at = NOW()
          WHERE id = $7 RETURNING *`,
        [JSON.stringify(applied.routeSnapshot), JSON.stringify(health),
          JSON.stringify({ initial_health: health, started_at: new Date().toISOString() }),
          applied.settings.caddyfile, applied.healthUrl, rollbackDeadline, runId],
      );
      await client.query(
        `INSERT INTO website_staging_edge_events (run_id, actor_user_id, event_type, details)
         VALUES ($1,$2,'caddy_validated',$3::jsonb), ($1,$2,'caddy_reloaded',$4::jsonb),
                ($1,$2,'health_passed',$5::jsonb)`,
        [runId, request.authUser.id, JSON.stringify({ caddyfile: applied.settings.caddyfile }),
          JSON.stringify(applied.routeSnapshot), JSON.stringify(health)],
      );
      return result.rows[0];
    });
    return response.status(201).json({
      ok: true,
      run: shapeRun(monitoring, await events(runId)),
      staging_traffic_changed: true,
      production_traffic_changed: false,
      production_cutover_performed: false,
    });
  } catch (error) {
    if (error?.code === '23505') return response.status(409).json({ message: 'Another staging-edge run is active.' });
    if (runId) {
      await deactivateStagingEdge({ reason: 'Step 14 apply failed before health verification.' }).catch(() => {});
      await query(
        `UPDATE website_staging_edge_runs
            SET status = 'failed', staging_traffic_changed = FALSE,
                failure_message = $1, updated_at = NOW()
          WHERE id = $2 AND status = 'applying'`,
        [String(error?.message || error), runId],
      ).catch(() => {});
    }
    return next(error);
  }
});

router.post('/runs/:runId/rollback', async (request, response, next) => {
  try {
    const row = (await query('SELECT * FROM website_staging_edge_runs WHERE id = $1 LIMIT 1', [request.params.runId])).rows[0];
    if (!row) return response.status(404).json({ message: 'Staging-edge run not found.' });
    if (row.status !== 'monitoring') return response.status(409).json({ message: `Only a monitoring run can be rolled back. Current status: ${row.status}.` });
    const rollback = await deactivateStagingEdge({ reason: 'Administrator requested Step 14 staging rollback.' });
    const updated = await transaction(async client => {
      const result = await client.query(
        `UPDATE website_staging_edge_runs
            SET status = 'rolled_back', staging_traffic_changed = FALSE,
                rolled_back_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status = 'monitoring' RETURNING *`,
        [row.id],
      );
      await client.query(
        `INSERT INTO website_staging_edge_events (run_id, actor_user_id, event_type, details)
         VALUES ($1,$2,'manual_rollback',$3::jsonb)`,
        [row.id, request.authUser.id, JSON.stringify(rollback)],
      );
      return result.rows[0];
    });
    return response.json({ ok: true, run: shapeRun(updated, await events(row.id)), production_traffic_changed: false });
  } catch (error) { return next(error); }
});

router.post('/runs/:runId/pass', async (request, response, next) => {
  try {
    const settings = stagingEdgeSettings();
    const row = (await query(
      `SELECT r.*, w.site_key FROM website_staging_edge_runs r JOIN websites w ON w.id = r.website_id
        WHERE r.id = $1 LIMIT 1`,
      [request.params.runId],
    )).rows[0];
    if (!row) return response.status(404).json({ message: 'Staging-edge run not found.' });
    if (row.status !== 'monitoring') return response.status(409).json({ message: `Only a monitoring run can pass. Current status: ${row.status}.` });
    const observedSeconds = row.activated_at ? Math.floor((Date.now() - new Date(row.activated_at).getTime()) / 1000) : 0;
    if (observedSeconds < settings.minObservationSeconds) {
      return response.status(409).json({
        message: `Staging observation window has not completed. ${settings.minObservationSeconds - observedSeconds}s remain.`,
        observed_seconds: observedSeconds,
      });
    }
    const health = await checkStagingEdgeHealth({ runId: row.id, expectedSiteKey: row.site_key, expectedHeldCommit: row.held_runtime_commit });
    if (!health.ok) return response.status(409).json({ message: 'The staging edge is not healthy enough to pass.', health });
    const completion = await deactivateStagingEdge({ reason: 'Administrator accepted the healthy Step 14 staging rehearsal.' });
    const updated = await transaction(async client => {
      const result = await client.query(
        `UPDATE website_staging_edge_runs
            SET status = 'passed', staging_traffic_changed = FALSE,
                health_snapshot = $1::jsonb, monitor_snapshot = $2::jsonb,
                last_healthy_at = NOW(), consecutive_failures = 0,
                passed_at = NOW(), updated_at = NOW()
          WHERE id = $3 AND status = 'monitoring' RETURNING *`,
        [JSON.stringify(health), JSON.stringify({ completion, final_health: health }), row.id],
      );
      await client.query(
        `INSERT INTO website_staging_edge_events (run_id, actor_user_id, event_type, details)
         VALUES ($1,$2,'passed',$3::jsonb)`,
        [row.id, request.authUser.id, JSON.stringify({ completion, health })],
      );
      return result.rows[0];
    });
    return response.json({
      ok: true,
      run: shapeRun(updated, await events(row.id)),
      message: 'Real staging-edge rehearsal passed. Customer production traffic is still unchanged.',
      production_traffic_changed: false,
    });
  } catch (error) { return next(error); }
});

router.post('/runs/:runId/failure-drill', async (request, response, next) => {
  try {
    const settings = stagingEdgeSettings();
    if (!settings.failureDrillAllowed) return response.status(409).json({ message: 'The real staging failure drill is disabled.' });
    const row = (await query('SELECT * FROM website_staging_edge_runs WHERE id = $1 LIMIT 1', [request.params.runId])).rows[0];
    if (!row) return response.status(404).json({ message: 'Staging-edge run not found.' });
    if (row.status !== 'monitoring') return response.status(409).json({ message: `Only a monitoring run can run a failure drill. Current status: ${row.status}.` });
    await breakStagingEdgeForDrill();
    for (let index = 0; index < settings.failureThreshold; index += 1) await monitorStagingEdgeRuns();
    const updated = (await query('SELECT * FROM website_staging_edge_runs WHERE id = $1 LIMIT 1', [row.id])).rows[0];
    return response.json({
      ok: updated.status === 'rolled_back',
      automatic_rollback: Boolean(updated.automatic_rollback),
      run: shapeRun(updated, await events(row.id)),
      production_traffic_changed: false,
    });
  } catch (error) { return next(error); }
});

export default router;
