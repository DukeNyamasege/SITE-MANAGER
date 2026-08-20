import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
try {
  const columns = await pool.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'website_deployments'
  `);
  const names = new Set(columns.rows.map(row => row.column_name));
  for (const required of [
    'id', 'website_id', 'requested_by_user_id', 'hostname', 'runtime_name', 'runtime_release',
    'contract_version', 'publish_mode', 'status', 'manifest', 'route_path', 'healthcheck_url',
    'failure_message', 'prepared_at', 'activated_at', 'superseded_at', 'created_at', 'updated_at',
  ]) assert.ok(names.has(required), `website_deployments is missing ${required}`);

  const indexes = await pool.query(`
    SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'website_deployments'
  `);
  const indexNames = new Set(indexes.rows.map(row => row.indexname));
  assert.ok(indexNames.has('website_deployments_one_active_per_site'));
  assert.ok(indexNames.has('website_deployments_website_id_idx'));

  console.log('VPS publishing schema validation passed.');
} finally {
  await pool.end();
}
