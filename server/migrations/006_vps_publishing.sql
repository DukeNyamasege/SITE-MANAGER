CREATE TABLE IF NOT EXISTS website_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  hostname TEXT NOT NULL,
  runtime_name TEXT NOT NULL DEFAULT 'nnn',
  runtime_release TEXT NOT NULL,
  contract_version INTEGER NOT NULL DEFAULT 2 CHECK (contract_version > 0),
  publish_mode TEXT NOT NULL DEFAULT 'plan' CHECK (publish_mode IN ('plan', 'apply')),
  status TEXT NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing', 'prepared', 'activating', 'active', 'failed', 'superseded')),
  manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  route_path TEXT,
  healthcheck_url TEXT,
  failure_message TEXT,
  prepared_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS website_deployments_website_id_idx
  ON website_deployments(website_id, created_at DESC);
CREATE INDEX IF NOT EXISTS website_deployments_status_idx
  ON website_deployments(status);
CREATE UNIQUE INDEX IF NOT EXISTS website_deployments_one_active_per_site
  ON website_deployments(website_id)
  WHERE status = 'active';

-- Site Manager publishes hostname/routing state only. Every deployment serves the
-- same shared nnn distribution and resolves customer-specific configuration from
-- the runtime API/PostgreSQL. Billing is intentionally not part of publishing.
