import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
try {
  const columns = await pool.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'website_production_eligibility'
  `);
  const names = new Set(columns.rows.map(row => row.column_name));
  for (const required of [
    'id', 'website_id', 'legacy_import_id', 'parity_report_id', 'cutover_plan_id',
    'canary_execution_id', 'staging_edge_run_id', 'created_by_user_id', 'approved_by_user_id',
    'status', 'production_eligibility_contract_version', 'evidence_fingerprint',
    'legacy_source_commit', 'legacy_source_fingerprint', 'held_runtime_commit', 'v2_fingerprint',
    'primary_hostname', 'checks', 'evidence_snapshot', 'rollback_snapshot', 'eligible_at',
    'expires_at', 'approved_at', 'invalidated_at', 'invalidated_reason',
    'production_traffic_changed', 'production_cutover_performed', 'created_at', 'updated_at',
  ]) assert.ok(names.has(required), `website_production_eligibility is missing ${required}`);

  const indexes = await pool.query(`
    SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'website_production_eligibility'
  `);
  const indexNames = new Set(indexes.rows.map(row => row.indexname));
  assert.ok(indexNames.has('website_production_eligibility_one_actionable_per_site'));
  assert.ok(indexNames.has('website_production_eligibility_website_idx'));
  assert.ok(indexNames.has('website_production_eligibility_staging_idx'));

  const eventTable = await pool.query(`
    SELECT COUNT(*)::int AS count
      FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'website_production_eligibility_events'
  `);
  assert.equal(eventTable.rows[0].count, 1);

  console.log('Step 15 production eligibility schema validation passed.');
} finally {
  await pool.end();
}
