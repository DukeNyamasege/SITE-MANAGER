import { query, transaction } from './db.js';
import {
  checkStagingEdgeHealth,
  deactivateStagingEdge,
  stagingEdgeSettings,
} from './staging-edge-executor.js';

let timer = null;
let running = false;

async function addEvent(runId, eventType, details = {}) {
  await query(
    `INSERT INTO website_staging_edge_events (run_id, event_type, details)
     VALUES ($1,$2,$3::jsonb)`,
    [runId, eventType, JSON.stringify(details)],
  );
}

async function automaticRollback(row, reason, health = {}) {
  const rollback = await deactivateStagingEdge({ reason });
  const updated = await transaction(async client => {
    const result = await client.query(
      `UPDATE website_staging_edge_runs
          SET status = 'rolled_back', automatic_rollback = TRUE,
              staging_traffic_changed = FALSE, health_snapshot = $1::jsonb,
              monitor_snapshot = $2::jsonb, rolled_back_at = NOW(),
              failure_message = $3, updated_at = NOW()
        WHERE id = $4 AND status IN ('applying', 'monitoring')
        RETURNING *`,
      [JSON.stringify(health || {}), JSON.stringify({ reason, rollback }), reason, row.id],
    );
    if (result.rows[0]) {
      await client.query(
        `INSERT INTO website_staging_edge_events (run_id, event_type, details)
         VALUES ($1,'health_failed',$2::jsonb), ($1,'automatic_rollback',$3::jsonb)`,
        [row.id, JSON.stringify(health || { reason }), JSON.stringify(rollback)],
      );
    }
    return result.rows[0] || row;
  });
  return updated;
}

async function passHealthyRun(row, health) {
  const completion = await deactivateStagingEdge({ reason: 'Step 14 staging rollback window completed healthy.' });
  return transaction(async client => {
    const result = await client.query(
      `UPDATE website_staging_edge_runs
          SET status = 'passed', staging_traffic_changed = FALSE,
              health_snapshot = $1::jsonb, monitor_snapshot = $2::jsonb,
              last_healthy_at = NOW(), consecutive_failures = 0,
              passed_at = NOW(), updated_at = NOW()
        WHERE id = $3 AND status = 'monitoring'
        RETURNING *`,
      [JSON.stringify(health), JSON.stringify({ completion, final_health: health }), row.id],
    );
    if (result.rows[0]) {
      await client.query(
        `INSERT INTO website_staging_edge_events (run_id, event_type, details)
         VALUES ($1,'passed',$2::jsonb)`,
        [row.id, JSON.stringify({ completion, health })],
      );
    }
    return result.rows[0] || row;
  });
}

export async function monitorStagingEdgeRuns({ recovered = false } = {}) {
  if (running) return [];
  const settings = stagingEdgeSettings();
  if (settings.mode !== 'staging') return [];
  running = true;
  try {
    const active = (await query(
      `SELECT r.*, w.site_key
         FROM website_staging_edge_runs r
         JOIN websites w ON w.id = r.website_id
        WHERE r.status IN ('applying', 'monitoring')
        ORDER BY r.created_at ASC`,
    )).rows;
    const results = [];

    for (const row of active) {
      if (row.status === 'applying') {
        try {
          const rolled = await automaticRollback(
            row,
            'Site Manager recovered an incomplete staging-edge apply and removed the route instead of assuming it was healthy.',
            { ok: false, recovered_incomplete_apply: true },
          );
          results.push({ id: row.id, status: rolled.status, recovered: true });
        } catch (error) {
          await query(
            `UPDATE website_staging_edge_runs SET status = 'failed', failure_message = $1, updated_at = NOW()
              WHERE id = $2 AND status = 'applying'`,
            [String(error?.message || error), row.id],
          ).catch(() => {});
          results.push({ id: row.id, status: 'failed', error: String(error?.message || error) });
        }
        continue;
      }

      if (recovered && !row.recovered_at) {
        await transaction(async client => {
          await client.query('UPDATE website_staging_edge_runs SET recovered_at = NOW(), updated_at = NOW() WHERE id = $1', [row.id]);
          await client.query(
            `INSERT INTO website_staging_edge_events (run_id, event_type, details)
             VALUES ($1,'monitor_recovered',$2::jsonb)`,
            [row.id, JSON.stringify({ recovered_at: new Date().toISOString(), production_traffic_changed: false })],
          );
        });
      }

      let health;
      try {
        health = await checkStagingEdgeHealth({
          runId: row.id,
          expectedSiteKey: row.site_key,
          expectedHeldCommit: row.held_runtime_commit,
        });
      } catch (error) {
        health = {
          ok: false,
          failed: ['health_request_error'],
          error: String(error?.message || error),
          checked_at: new Date().toISOString(),
          production_traffic_changed: false,
          production_cutover_performed: false,
        };
      }

      if (health.ok) {
        const deadlineReached = row.rollback_deadline && new Date(row.rollback_deadline).getTime() <= Date.now();
        if (deadlineReached) {
          const passed = await passHealthyRun(row, health);
          results.push({ id: row.id, status: passed.status, health });
          continue;
        }
        await transaction(async client => {
          await client.query(
            `UPDATE website_staging_edge_runs
                SET health_snapshot = $1::jsonb,
                    monitor_snapshot = $2::jsonb,
                    last_healthy_at = NOW(), consecutive_failures = 0, updated_at = NOW()
              WHERE id = $3 AND status = 'monitoring'`,
            [JSON.stringify(health), JSON.stringify({ last_tick_at: health.checked_at, ok: true }), row.id],
          );
          await client.query(
            `INSERT INTO website_staging_edge_events (run_id, event_type, details)
             VALUES ($1,'monitor_tick',$2::jsonb)`,
            [row.id, JSON.stringify({ ok: true, checked_at: health.checked_at })],
          );
        });
        results.push({ id: row.id, status: 'monitoring', health });
        continue;
      }

      const failures = Number(row.consecutive_failures || 0) + 1;
      if (failures >= settings.failureThreshold) {
        const rolled = await automaticRollback(
          row,
          `Staging-edge health failed ${failures} consecutive time(s); the staging route was automatically rolled back.`,
          health,
        );
        results.push({ id: row.id, status: rolled.status, health });
        continue;
      }

      await transaction(async client => {
        await client.query(
          `UPDATE website_staging_edge_runs
              SET health_snapshot = $1::jsonb,
                  monitor_snapshot = $2::jsonb,
                  consecutive_failures = $3, updated_at = NOW()
            WHERE id = $4 AND status = 'monitoring'`,
          [JSON.stringify(health), JSON.stringify({ last_tick_at: health.checked_at, ok: false }), failures, row.id],
        );
        await client.query(
          `INSERT INTO website_staging_edge_events (run_id, event_type, details)
           VALUES ($1,'monitor_tick',$2::jsonb)`,
          [row.id, JSON.stringify({ ok: false, failures, health })],
        );
      });
      results.push({ id: row.id, status: 'monitoring', failures, health });
    }
    return results;
  } finally {
    running = false;
  }
}

export async function recoverStagingEdgeMonitor() {
  const settings = stagingEdgeSettings();
  if (settings.mode !== 'staging') return [];
  return monitorStagingEdgeRuns({ recovered: true });
}

export function startStagingEdgeMonitor() {
  const settings = stagingEdgeSettings();
  if (settings.mode !== 'staging' || timer) return false;
  void recoverStagingEdgeMonitor().catch(error => console.error('Staging edge recovery failed:', error));
  timer = setInterval(() => {
    void monitorStagingEdgeRuns().catch(error => console.error('Staging edge monitor failed:', error));
  }, settings.monitorIntervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return true;
}

export function stopStagingEdgeMonitor() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
