import express from 'express';
import { query, transaction } from './db.js';
import { requireAuthenticatedUser } from './session.js';
import {
  buildDeploymentManifest,
  publisherSettings,
  publishSharedRuntime,
  PUBLISHING_CONTRACT_VERSION,
} from './vps-publisher.js';

const router = express.Router();
router.use(requireAuthenticatedUser);

async function technicalReadiness(websiteId, userId) {
  const result = await query(
    `SELECT w.id, w.name, w.site_key, w.source, w.status, w.preview_approved_at, w.deployment_status,
            c.configuration_status, c.deriv_client_id, c.deriv_environment,
            d.id AS domain_id, d.hostname, d.kind AS domain_kind,
            d.ownership_status, d.routing_status, d.ssl_status
       FROM websites w
       JOIN website_configs c ON c.website_id = w.id
       LEFT JOIN website_domains d ON d.website_id = w.id AND d.is_primary = TRUE
      WHERE w.id = $1 AND w.owner_user_id = $2 AND w.status <> 'archived'
      LIMIT 1`,
    [websiteId, userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const checks = {
    configuration_complete: row.configuration_status === 'complete',
    preview_approved: Boolean(row.preview_approved_at),
    hostname_selected: Boolean(row.hostname),
    ownership_verified: Boolean(row.hostname && ['verified', 'not_required'].includes(row.ownership_status)),
    routing_ready: row.routing_status === 'ready',
    ssl_eligible: Boolean(row.hostname && ['eligible', 'provisioned'].includes(row.ssl_status)),
    deriv_client_configured: Boolean(String(row.deriv_client_id || '').trim()),
  };
  return {
    website: {
      id: row.id,
      name: row.name,
      site_key: row.site_key,
      source: row.source,
      status: row.status,
      deployment_status: row.deployment_status,
    },
    primary_domain: row.hostname ? {
      id: row.domain_id,
      hostname: row.hostname,
      kind: row.domain_kind,
      ownership_status: row.ownership_status,
      routing_status: row.routing_status,
      ssl_status: row.ssl_status,
    } : null,
    deriv_environment: row.deriv_environment === 'staging' ? 'staging' : 'production',
    callback_url: row.hostname ? `https://${row.hostname}/callback` : '',
    checks,
    deployment_ready: Object.values(checks).every(Boolean),
    billing_required: false,
  };
}

function shapeDeployment(row) {
  return {
    id: row.id,
    website_id: row.website_id,
    hostname: row.hostname,
    runtime_name: row.runtime_name,
    runtime_release: row.runtime_release,
    contract_version: Number(row.contract_version),
    publish_mode: row.publish_mode,
    status: row.status,
    manifest: row.manifest || {},
    route_path: row.route_path,
    healthcheck_url: row.healthcheck_url,
    failure_message: row.failure_message,
    prepared_at: row.prepared_at,
    activated_at: row.activated_at,
    superseded_at: row.superseded_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function deploymentHistory(websiteId, userId) {
  const result = await query(
    `SELECT d.*
       FROM website_deployments d
       JOIN websites w ON w.id = d.website_id
      WHERE d.website_id = $1 AND w.owner_user_id = $2
      ORDER BY d.created_at DESC
      LIMIT 50`,
    [websiteId, userId],
  );
  return result.rows.map(shapeDeployment);
}

router.get('/:websiteId', async (request, response, next) => {
  try {
    const readiness = await technicalReadiness(request.params.websiteId, request.authUser.id);
    if (!readiness) return response.status(404).json({ message: 'Website not found.' });
    const settings = publisherSettings();
    return response.json({
      readiness,
      deployments: await deploymentHistory(request.params.websiteId, request.authUser.id),
      publisher: {
        mode: settings.mode,
        contract_version: PUBLISHING_CONTRACT_VERSION,
        runtime: 'nnn',
        runtime_release: settings.runtimeRelease,
        shared_runtime_dir: settings.sharedRuntimeDir,
        api_upstream: settings.apiUpstream,
      },
    });
  } catch (error) { return next(error); }
});

router.post('/:websiteId/publish', async (request, response, next) => {
  let deploymentId = '';
  try {
    const readiness = await technicalReadiness(request.params.websiteId, request.authUser.id);
    if (!readiness) return response.status(404).json({ message: 'Website not found.' });
    if (readiness.website.source === 'migrated') {
      return response.status(409).json({
        message: 'Migrated legacy nnn sites cannot use the ordinary customer publish path. They must pass parity, an immutable admin cutover plan and the canary execution gate.',
        cutover_required: true,
        readiness,
      });
    }
    if (!readiness.deployment_ready || !readiness.primary_domain?.hostname) {
      return response.status(409).json({
        message: 'This website has not passed the technical deployment gate.',
        readiness,
      });
    }

    const settings = publisherSettings();
    const previousActive = await query(
      `SELECT id, hostname, route_path FROM website_deployments
        WHERE website_id = $1 AND status = 'active'
        ORDER BY activated_at DESC NULLS LAST LIMIT 1`,
      [readiness.website.id],
    );
    const previous = previousActive.rows[0] || null;

    const inserted = await transaction(async client => {
      const created = await client.query(
        `INSERT INTO website_deployments
           (website_id, requested_by_user_id, hostname, runtime_name, runtime_release, contract_version, publish_mode, status)
         VALUES ($1, $2, $3, 'nnn', $4, $5, $6, $7)
         RETURNING *`,
        [
          readiness.website.id,
          request.authUser.id,
          readiness.primary_domain.hostname,
          settings.runtimeRelease,
          PUBLISHING_CONTRACT_VERSION,
          settings.mode,
          settings.mode === 'apply' ? 'activating' : 'preparing',
        ],
      );
      await client.query(
        `UPDATE websites SET deployment_status = $1, status = CASE WHEN $1 = 'deploying' THEN 'deploying' ELSE status END, updated_at = NOW()
          WHERE id = $2 AND owner_user_id = $3`,
        [settings.mode === 'apply' ? 'deploying' : 'queued', readiness.website.id, request.authUser.id],
      );
      return created.rows[0];
    });
    deploymentId = inserted.id;

    const manifest = buildDeploymentManifest({
      deploymentId,
      websiteId: readiness.website.id,
      siteKey: readiness.website.site_key,
      hostname: readiness.primary_domain.hostname,
      runtimeRelease: settings.runtimeRelease,
      sharedRuntimeDir: settings.sharedRuntimeDir,
      apiUpstream: settings.apiUpstream,
    });

    await query(
      `UPDATE website_deployments
          SET manifest = $1::jsonb, healthcheck_url = $2, updated_at = NOW()
        WHERE id = $3`,
      [JSON.stringify(manifest), manifest.healthcheck_url, deploymentId],
    );

    const retireRoutePaths = previous?.route_path && previous.hostname !== readiness.primary_domain.hostname
      ? [previous.route_path]
      : [];
    const result = await publishSharedRuntime(manifest, { retireRoutePaths });
    if (!result.applied) {
      await transaction(async client => {
        await client.query(
          `UPDATE website_deployments
              SET status = 'prepared', route_path = $1, prepared_at = NOW(), updated_at = NOW()
            WHERE id = $2`,
          [result.route_path, deploymentId],
        );
        await client.query(
          `UPDATE websites SET deployment_status = $1, status = $2, updated_at = NOW() WHERE id = $3`,
          [previous ? 'deployed' : 'queued', previous ? 'live' : readiness.website.status, readiness.website.id],
        );
      });
      return response.status(201).json({
        message: result.message,
        deployment: shapeDeployment((await query('SELECT * FROM website_deployments WHERE id = $1', [deploymentId])).rows[0]),
        readiness,
        live: Boolean(previous),
      });
    }

    await transaction(async client => {
      await client.query(
        `UPDATE website_deployments
            SET status = 'superseded', superseded_at = NOW(), updated_at = NOW()
          WHERE website_id = $1 AND status = 'active' AND id <> $2`,
        [readiness.website.id, deploymentId],
      );
      await client.query(
        `UPDATE website_deployments
            SET status = 'active', route_path = $1, prepared_at = COALESCE(prepared_at, NOW()), activated_at = NOW(), updated_at = NOW()
          WHERE id = $2`,
        [result.route_path, deploymentId],
      );
      await client.query(
        `UPDATE websites SET status = 'live', deployment_status = 'deployed', updated_at = NOW() WHERE id = $1`,
        [readiness.website.id],
      );
      await client.query(
        `UPDATE website_domains SET ssl_status = 'provisioned', updated_at = NOW()
          WHERE website_id = $1 AND is_primary = TRUE`,
        [readiness.website.id],
      );
    });

    return response.status(201).json({
      message: result.message,
      deployment: shapeDeployment((await query('SELECT * FROM website_deployments WHERE id = $1', [deploymentId])).rows[0]),
      readiness: await technicalReadiness(request.params.websiteId, request.authUser.id),
      live: true,
      health: result.health,
    });
  } catch (error) {
    if (deploymentId) {
      await query(
        `UPDATE website_deployments SET status = 'failed', failure_message = $1, updated_at = NOW() WHERE id = $2`,
        [String(error?.message || error), deploymentId],
      ).catch(() => {});
      await transaction(async client => {
        const current = await client.query('SELECT website_id FROM website_deployments WHERE id = $1', [deploymentId]);
        const websiteId = current.rows[0]?.website_id;
        if (!websiteId) return;
        const active = await client.query(
          `SELECT id FROM website_deployments WHERE website_id = $1 AND status = 'active' AND id <> $2 LIMIT 1`,
          [websiteId, deploymentId],
        );
        await client.query(
          `UPDATE websites SET deployment_status = $1, status = $2, updated_at = NOW() WHERE id = $3`,
          [active.rows[0] ? 'deployed' : 'failed', active.rows[0] ? 'live' : 'ready', websiteId],
        );
      }).catch(() => {});
    }
    return next(error);
  }
});

export default router;
