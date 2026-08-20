import 'dotenv/config';
import assert from 'node:assert/strict';
import { getPool } from '../server/db.js';

const pool = getPool();
try {
  const columns = (await pool.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'domain_onboarding_intents'
  `)).rows.map(row => row.column_name);
  for (const required of [
    'id', 'user_id', 'hostname', 'registrar', 'status', 'availability_status',
    'availability_source', 'is_premium', 'premium_registration_price',
    'premium_renewal_price', 'purchase_status', 'ownership_status',
    'verification_token', 'verification_record_name', 'verification_record_value',
    'ownership_verified_at', 'claimed_website_id',
  ]) assert.ok(columns.includes(required), `domain_onboarding_intents is missing ${required}`);

  const indexes = (await pool.query(`
    SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'domain_onboarding_intents'
  `)).rows;
  assert.ok(indexes.some(row => row.indexname === 'domain_onboarding_one_verified_owner_per_hostname'));
  assert.ok(indexes.some(row => row.indexname === 'domain_onboarding_claimed_website_unique'));

  const websiteDomains = (await pool.query(`
    SELECT COUNT(*)::int AS count FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'website_domains'
  `)).rows[0];
  assert.equal(websiteDomains.count, 1, 'website_domains must exist before domain-first onboarding is used.');

  console.log('Domain-first onboarding schema validation passed.');
} finally {
  await pool.end();
}
