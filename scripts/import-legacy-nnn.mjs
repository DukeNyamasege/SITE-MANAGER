import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getPool } from '../server/db.js';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const sourceDir = path.resolve(process.env.NNN_LEGACY_SOURCE_DIR || process.argv.find(value => value.startsWith('--source='))?.slice(9) || '../nnn');
const expectedSha = String(process.env.NNN_LEGACY_EXPECTED_SHA || '').trim();
const reportPath = String(process.env.LEGACY_NNN_REPORT_PATH || '').trim();

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const cleanHost = value => String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function optionalFile(file) {
  try { return await fs.readFile(file, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function gitSha() {
  try {
    return execFileSync('git', ['-C', sourceDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error(`NNN_LEGACY_SOURCE_DIR must be a Git checkout: ${sourceDir}`);
  }
}

function validateInventory(items) {
  const ids = new Set();
  const hosts = new Map();
  const errors = [];
  for (const item of items) {
    if (!/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(item.legacy_site_id)) errors.push(`${item.legacy_site_id}: invalid site id`);
    if (ids.has(item.legacy_site_id)) errors.push(`${item.legacy_site_id}: duplicate site id`);
    ids.add(item.legacy_site_id);
    if (!item.display_domain || !item.display_domain.includes('.')) errors.push(`${item.legacy_site_id}: invalid display domain`);
    if (!item.deriv_client_id) errors.push(`${item.legacy_site_id}: missing Deriv client id`);
    for (const host of item.hosts) {
      const normalized = cleanHost(host);
      const owner = hosts.get(normalized);
      if (owner && owner !== item.legacy_site_id) errors.push(`${normalized}: duplicate host used by ${owner} and ${item.legacy_site_id}`);
      hosts.set(normalized, item.legacy_site_id);
    }
  }
  if (errors.length) throw new Error(`Legacy nnn inventory validation failed:\n- ${errors.join('\n- ')}`);
}

async function buildInventory() {
  const sourceCommit = gitSha();
  if (expectedSha && sourceCommit !== expectedSha) {
    throw new Error(`Legacy nnn source SHA mismatch. Expected ${expectedSha}, got ${sourceCommit}.`);
  }

  const registryText = await fs.readFile(path.join(sourceDir, 'brand.config.json'), 'utf8');
  const registry = JSON.parse(registryText);
  const catalog = await readJson(path.join(sourceDir, 'public/site-config/catalog.json'));
  const entries = Array.isArray(registry?.sites?.entries) ? registry.sites.entries : [];
  if (!entries.length) throw new Error('brand.config.json does not contain managed sites.entries.');

  const inventory = [];
  for (const entry of entries) {
    const siteId = String(entry.id || '').trim();
    const customizationPath = path.join(sourceDir, 'public/site-config/domains', `${siteId}.json`);
    const customizationText = await optionalFile(customizationPath);
    const explicitCustomization = customizationText ? JSON.parse(customizationText) : null;
    const customization = explicitCustomization || {
      version: 1,
      site_id: siteId,
      navigation: catalog.defaults.navigation,
      colors: catalog.defaults.colors,
    };

    const botRelativePath = `public/free-bots/domains/${siteId}.json`;
    const botText = await optionalFile(path.join(sourceDir, botRelativePath));
    const snapshot = {
      registry_entry: entry,
      customization,
      customization_source: explicitCustomization ? 'explicit' : 'inherited_defaults',
      free_bot_manifest: botText ? { path: botRelativePath, sha256: sha256(botText) } : null,
    };

    inventory.push({
      legacy_site_id: siteId,
      source_repository: 'DukeNyamasege/nnn',
      source_commit: sourceCommit,
      source_registry_sha: sha256(registryText),
      display_domain: cleanHost(entry.display_domain || entry.hosts?.[0]),
      hosts: [...new Set((entry.hosts || []).map(cleanHost).filter(Boolean))],
      website_url: String(entry.website_url || ''),
      redirect_uri: String(entry.redirect_uri || ''),
      deriv_client_id: String(entry.client_id || ''),
      deriv_scopes: Array.isArray(entry.scopes) ? entry.scopes : ['trade', 'application_read'],
      deriv_environment: entry.environment === 'staging' ? 'staging' : 'production',
      customization,
      customization_source: explicitCustomization ? 'explicit' : 'inherited_defaults',
      free_bot_manifest_path: botText ? botRelativePath : null,
      free_bot_manifest_sha: botText ? sha256(botText) : null,
      source_snapshot: snapshot,
      source_fingerprint: sha256(JSON.stringify(snapshot)),
    });
  }

  validateInventory(inventory);
  return { sourceCommit, inventory };
}

async function persist(inventory) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of inventory) {
      await client.query(
        `INSERT INTO legacy_nnn_site_imports
           (legacy_site_id, source_repository, source_commit, source_registry_sha,
            display_domain, hosts, website_url, redirect_uri, deriv_client_id,
            deriv_scopes, deriv_environment, customization, customization_source,
            free_bot_manifest_path, free_bot_manifest_sha, source_snapshot, source_fingerprint,
            drift_status, last_audited_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,$14,$15,$16::jsonb,$17,'not_assigned',NOW())
         ON CONFLICT (legacy_site_id) DO UPDATE SET
           source_repository = EXCLUDED.source_repository,
           source_commit = EXCLUDED.source_commit,
           source_registry_sha = EXCLUDED.source_registry_sha,
           display_domain = EXCLUDED.display_domain,
           hosts = EXCLUDED.hosts,
           website_url = EXCLUDED.website_url,
           redirect_uri = EXCLUDED.redirect_uri,
           deriv_client_id = EXCLUDED.deriv_client_id,
           deriv_scopes = EXCLUDED.deriv_scopes,
           deriv_environment = EXCLUDED.deriv_environment,
           customization = EXCLUDED.customization,
           customization_source = EXCLUDED.customization_source,
           free_bot_manifest_path = EXCLUDED.free_bot_manifest_path,
           free_bot_manifest_sha = EXCLUDED.free_bot_manifest_sha,
           source_snapshot = EXCLUDED.source_snapshot,
           source_fingerprint = EXCLUDED.source_fingerprint,
           drift_status = CASE
             WHEN legacy_nnn_site_imports.status = 'assigned'
               AND legacy_nnn_site_imports.assigned_source_fingerprint = EXCLUDED.source_fingerprint THEN 'current'
             WHEN legacy_nnn_site_imports.status = 'assigned' THEN 'drifted'
             ELSE 'not_assigned'
           END,
           last_audited_at = NOW(),
           updated_at = NOW()`,
        [
          item.legacy_site_id, item.source_repository, item.source_commit, item.source_registry_sha,
          item.display_domain, JSON.stringify(item.hosts), item.website_url, item.redirect_uri,
          item.deriv_client_id, JSON.stringify(item.deriv_scopes), item.deriv_environment,
          JSON.stringify(item.customization), item.customization_source, item.free_bot_manifest_path,
          item.free_bot_manifest_sha, JSON.stringify(item.source_snapshot), item.source_fingerprint,
        ],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const summary = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'unassigned')::int AS unassigned,
            COUNT(*) FILTER (WHERE status = 'assigned')::int AS assigned,
            COUNT(*) FILTER (WHERE drift_status = 'drifted')::int AS drifted
       FROM legacy_nnn_site_imports`,
  );
  await pool.end();
  return summary.rows[0];
}

const { sourceCommit, inventory } = await buildInventory();
const report = {
  mode: apply ? 'apply' : 'dry-run',
  source_repository: 'DukeNyamasege/nnn',
  source_commit: sourceCommit,
  site_count: inventory.length,
  explicit_customization_count: inventory.filter(item => item.customization_source === 'explicit').length,
  inherited_customization_count: inventory.filter(item => item.customization_source === 'inherited_defaults').length,
  free_bot_manifest_count: inventory.filter(item => item.free_bot_manifest_path).length,
  sites: inventory.map(item => ({
    site_id: item.legacy_site_id,
    display_domain: item.display_domain,
    hosts: item.hosts,
    customization_source: item.customization_source,
    free_bot_manifest_path: item.free_bot_manifest_path,
    source_fingerprint: item.source_fingerprint,
  })),
};

if (apply) report.database = await persist(inventory);
if (reportPath) await fs.writeFile(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
