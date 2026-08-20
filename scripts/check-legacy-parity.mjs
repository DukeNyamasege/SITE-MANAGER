import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getPool } from '../server/db.js';
import { evaluateDualRunParity } from '../server/parity-core.js';

const legacyDir = path.resolve(process.env.NNN_LEGACY_SOURCE_DIR || '../nnn');
const heldDir = path.resolve(process.env.NNN_HELD_RUNTIME_DIR || '../nnn-held');
const expectedLegacySha = String(process.env.NNN_LEGACY_EXPECTED_SHA || '').trim();
const expectedHeldSha = String(process.env.NNN_HELD_EXPECTED_SHA || '').trim();
const reportPath = String(process.env.DUAL_RUN_PARITY_REPORT_PATH || '').trim();

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const gitSha = dir => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

async function optionalBuffer(file) {
  try { return await fs.readFile(file); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function optionalJson(file) {
  const buffer = await optionalBuffer(file);
  return buffer ? JSON.parse(buffer.toString('utf8')) : null;
}

function findRegistryEntry(registry, siteId) {
  return (Array.isArray(registry?.sites?.entries) ? registry.sites.entries : []).find(entry => String(entry.id || '') === siteId) || null;
}

async function evidenceForSite(siteId, customizationSource, freeBotManifestPath) {
  const legacyRegistry = JSON.parse(await fs.readFile(path.join(legacyDir, 'brand.config.json'), 'utf8'));
  const heldRegistry = JSON.parse(await fs.readFile(path.join(heldDir, 'brand.config.json'), 'utf8'));
  const liveEntry = findRegistryEntry(legacyRegistry, siteId);
  const heldEntry = findRegistryEntry(heldRegistry, siteId);

  let customizationAssetsMatch = false;
  if (customizationSource === 'explicit') {
    const relative = path.join('public', 'site-config', 'domains', `${siteId}.json`);
    const [live, held] = await Promise.all([optionalBuffer(path.join(legacyDir, relative)), optionalBuffer(path.join(heldDir, relative))]);
    customizationAssetsMatch = Boolean(live && held && sha256(live) === sha256(held));
  } else {
    const [liveCatalog, heldCatalog] = await Promise.all([
      fs.readFile(path.join(legacyDir, 'public/site-config/catalog.json')),
      fs.readFile(path.join(heldDir, 'public/site-config/catalog.json')),
    ]);
    const liveDefaults = JSON.parse(liveCatalog.toString('utf8'))?.defaults || {};
    const heldDefaults = JSON.parse(heldCatalog.toString('utf8'))?.defaults || {};
    customizationAssetsMatch = JSON.stringify(liveDefaults) === JSON.stringify(heldDefaults);
  }

  let freeBotManifestMatch = true;
  let freeBotAssetsMatch = true;
  let assetChecks = [];
  if (freeBotManifestPath) {
    const liveManifestPath = path.join(legacyDir, freeBotManifestPath);
    const heldManifestPath = path.join(heldDir, freeBotManifestPath);
    const [liveManifestBuffer, heldManifestBuffer] = await Promise.all([optionalBuffer(liveManifestPath), optionalBuffer(heldManifestPath)]);
    freeBotManifestMatch = Boolean(liveManifestBuffer && heldManifestBuffer && sha256(liveManifestBuffer) === sha256(heldManifestBuffer));
    const liveManifest = liveManifestBuffer ? JSON.parse(liveManifestBuffer.toString('utf8')) : null;
    assetChecks = await Promise.all((Array.isArray(liveManifest?.bots) ? liveManifest.bots : []).map(async bot => {
      const asset = String(bot?.asset || '').replace(/^\/+/, '');
      if (!asset) return { id: String(bot?.id || ''), asset: '', match: false };
      const relative = path.join('public', 'free-bots', asset);
      const [liveAsset, heldAsset] = await Promise.all([optionalBuffer(path.join(legacyDir, relative)), optionalBuffer(path.join(heldDir, relative))]);
      return {
        id: String(bot?.id || ''),
        asset,
        match: Boolean(liveAsset && heldAsset && sha256(liveAsset) === sha256(heldAsset)),
      };
    }));
    freeBotAssetsMatch = assetChecks.every(item => item.match);
  } else {
    const heldManifest = await optionalBuffer(path.join(heldDir, 'public', 'free-bots', 'domains', `${siteId}.json`));
    freeBotManifestMatch = !heldManifest;
  }

  const runtimeContract = await optionalJson(path.join(heldDir, 'public', 'site-manager-runtime.json'));
  const runtimeContractCompatible = Number(runtimeContract?.contract_version) === 2
    && Number(runtimeContract?.migration_contract_version) === 1
    && runtimeContract?.runtime === 'nnn';

  return {
    registry_entry_match: Boolean(liveEntry && heldEntry && JSON.stringify(liveEntry) === JSON.stringify(heldEntry)),
    customization_assets_match: customizationAssetsMatch,
    free_bot_manifest_match: freeBotManifestMatch,
    free_bot_assets_match: freeBotAssetsMatch,
    runtime_contract_compatible: runtimeContractCompatible,
    bot_asset_checks: assetChecks,
  };
}

async function loadContext(pool, importItem) {
  const websiteResult = await pool.query(
    `SELECT w.*, c.brand_name, c.tagline, c.logo_url, c.navigation, c.colors, c.deriv_client_id, c.deriv_scopes,
            c.deriv_environment, c.configuration_status
       FROM websites w JOIN website_configs c ON c.website_id = w.id
      WHERE w.id = $1 LIMIT 1`,
    [importItem.website_id],
  );
  const domains = await pool.query(
    `SELECT id, hostname, kind, is_primary, ownership_status, routing_status, ssl_status
       FROM website_domains WHERE website_id = $1 ORDER BY hostname`,
    [importItem.website_id],
  );
  return { website: websiteResult.rows[0], config: websiteResult.rows[0], domains: domains.rows };
}

const legacySha = gitSha(legacyDir);
const heldSha = gitSha(heldDir);
if (expectedLegacySha && legacySha !== expectedLegacySha) throw new Error(`Legacy nnn SHA mismatch. Expected ${expectedLegacySha}, got ${legacySha}.`);
if (expectedHeldSha && heldSha !== expectedHeldSha) throw new Error(`Held nnn SHA mismatch. Expected ${expectedHeldSha}, got ${heldSha}.`);

const pool = getPool();
const assigned = await pool.query(`SELECT * FROM legacy_nnn_site_imports WHERE status = 'assigned' ORDER BY legacy_site_id`);
const results = [];

for (const importItem of assigned.rows) {
  const runtimeEvidence = await evidenceForSite(importItem.legacy_site_id, importItem.customization_source, importItem.free_bot_manifest_path);
  const context = await loadContext(pool, importItem);
  const transientReport = {
    legacy_source_commit: importItem.source_commit,
    legacy_source_fingerprint: importItem.source_fingerprint,
    held_runtime_commit: heldSha,
    runtime_evidence: runtimeEvidence,
    production_cutover_performed: false,
  };
  const parity = evaluateDualRunParity({ importItem, ...context, parityReport: transientReport });

  await pool.query(
    `INSERT INTO legacy_nnn_parity_reports
       (legacy_import_id, website_id, legacy_source_commit, legacy_source_fingerprint,
        held_runtime_commit, runtime_evidence, checks, blockers, status,
        production_cutover_performed, ready_at, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,FALSE,$10,NOW())
     ON CONFLICT (website_id) DO UPDATE SET
       legacy_import_id = EXCLUDED.legacy_import_id,
       legacy_source_commit = EXCLUDED.legacy_source_commit,
       legacy_source_fingerprint = EXCLUDED.legacy_source_fingerprint,
       held_runtime_commit = EXCLUDED.held_runtime_commit,
       runtime_evidence = EXCLUDED.runtime_evidence,
       checks = EXCLUDED.checks,
       blockers = EXCLUDED.blockers,
       status = EXCLUDED.status,
       production_cutover_performed = FALSE,
       ready_at = EXCLUDED.ready_at,
       checked_at = NOW(),
       updated_at = NOW()`,
    [
      importItem.id,
      importItem.website_id,
      importItem.source_commit,
      importItem.source_fingerprint,
      heldSha,
      JSON.stringify(runtimeEvidence),
      JSON.stringify(parity.checks),
      JSON.stringify(parity.blockers),
      parity.status,
      parity.status === 'parity_ready' ? new Date() : null,
    ],
  );

  results.push({
    site_id: importItem.legacy_site_id,
    status: parity.status,
    cutover_ready: parity.cutover_ready,
    blockers: parity.blockers,
    runtime_evidence: runtimeEvidence,
  });
}

const report = {
  report_version: 1,
  legacy_source_commit: legacySha,
  held_runtime_commit: heldSha,
  assigned_sites: results.length,
  parity_ready: results.filter(item => item.cutover_ready).length,
  blocked: results.filter(item => !item.cutover_ready).length,
  production_cutover_performed: false,
  sites: results,
};
if (reportPath) await fs.writeFile(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await pool.end();
