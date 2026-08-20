import assert from 'node:assert/strict';
import pg from 'pg';

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const tables = await client.query(`
    SELECT to_regclass('public.website_domains') AS domains,
           to_regclass('public.websites') AS websites,
           to_regclass('public.website_configs') AS configs
  `);
  assert.equal(tables.rows[0].domains, 'website_domains');
  assert.equal(tables.rows[0].websites, 'websites');
  assert.equal(tables.rows[0].configs, 'website_configs');

  const columns = await client.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'website_domains'
  `);
  const domainColumns = new Set(columns.rows.map(row => row.column_name));
  for (const name of [
    'hostname', 'kind', 'is_primary', 'ownership_status', 'routing_status', 'ssl_status',
    'verification_record_name', 'verification_record_value', 'ownership_verified_at', 'routing_verified_at',
  ]) assert.equal(domainColumns.has(name), true, `missing website_domains.${name}`);

  const websiteColumns = await client.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'websites'
  `);
  assert.equal(new Set(websiteColumns.rows.map(row => row.column_name)).has('preview_approved_at'), true);

  const primaryIndex = await client.query(`
    SELECT indexname
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'website_domains'
       AND indexname = 'website_domains_one_primary_per_site'
  `);
  assert.equal(primaryIndex.rowCount, 1);

  console.log('VPS domain readiness schema validation passed.');
} finally {
  await client.end();
}
