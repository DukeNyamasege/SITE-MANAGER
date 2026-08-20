import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '..', 'server', 'migrations');

await getPool().query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

const entries = (await fs.readdir(migrationsDir))
  .filter(name => name.endsWith('.sql'))
  .sort();

for (const name of entries) {
  const already = await getPool().query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
  if (already.rowCount) continue;

  const sql = await fs.readFile(path.join(migrationsDir, name), 'utf8');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    await client.query('COMMIT');
    console.log(`Applied migration ${name}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

await getPool().end();
console.log('Database migrations complete.');
