import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
try {
  const columns = await pool.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'website_staging_edge_runs'
  `);
  const names = new Set(columns.rows.map(row => row.column_name));
  for (const required of [
    'id', 'canary_execution_id', 'plan_id', 'website_id', 'legacy_import_id',
    'requested_by_user_id', 'mode', 'status', 'staging_hostname', 'held_runtime_commit',
    'runtime_token_hash', 'runtime_token_expires_at', 'route_snapshot', 'rollback_snapshot',
    'health_snapshot', 'monitor_snapshot', 'route_path', 'health_url', 'rollback_deadline',
    'last_healthy_at', 'consecutive_failures', 'automatic_rollback', 'staging_traffic_changed',
    'production_traffic_changed', 'production_cutover_performed', 'activated_at', 'recovered_at',
    'passed_at', 'rolled_back_at', 'failure_message', 'created_at', 'updated_at',
  ]) assert.ok(names.has(required), `website_staging_edge_runs is missing ${required}`);

  const indexes = await pool.query(`
    SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'website_staging_edge_runs'
  `);
  const indexNames = new Set(indexes.rows.map(row => row.indexname));
  assert.ok(indexNames.has('website_staging_edge_one_active_globally'));
  assert.ok(indexNames.has('website_staging_edge_runs_canary_idx'));

  const constraints = await pool.query(`
    SELECT pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'website_staging_edge_runs' AND c.contype = 'c'
  `);
  const definitions = constraints.rows.map(row => row.definition).join('\n');
  assert.match(definitions, /production_traffic_changed = false/i);
  assert.match(definitions, /production_cutover_performed = false/i);
  assert.match(definitions, /mode.*staging/i);

  const eventTable = await pool.query(`SELECT to_regclass('public.website_staging_edge_events') AS name`);
  assert.equal(eventTable.rows[0]?.name, 'website_staging_edge_events');

  console.log('Step 14 staging-edge schema validation passed.');
} finally {
  await pool.end();
}
