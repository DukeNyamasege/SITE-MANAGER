CREATE TABLE IF NOT EXISTS website_staging_edge_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canary_execution_id UUID NOT NULL REFERENCES website_canary_executions(id) ON DELETE RESTRICT,
  plan_id UUID NOT NULL REFERENCES website_cutover_plans(id) ON DELETE RESTRICT,
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  legacy_import_id UUID NOT NULL REFERENCES legacy_nnn_site_imports(id) ON DELETE RESTRICT,
  requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL DEFAULT 'staging' CHECK (mode = 'staging'),
  status TEXT NOT NULL DEFAULT 'applying' CHECK (status IN ('applying', 'monitoring', 'passed', 'rolled_back', 'failed')),
  staging_hostname TEXT NOT NULL,
  held_runtime_commit CHAR(40) NOT NULL,
  runtime_token_hash CHAR(64) NOT NULL,
  runtime_token_expires_at TIMESTAMPTZ NOT NULL,
  route_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  rollback_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  health_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  monitor_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  route_path TEXT,
  health_url TEXT,
  rollback_deadline TIMESTAMPTZ,
  last_healthy_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  automatic_rollback BOOLEAN NOT NULL DEFAULT FALSE,
  staging_traffic_changed BOOLEAN NOT NULL DEFAULT FALSE,
  production_traffic_changed BOOLEAN NOT NULL DEFAULT FALSE,
  production_cutover_performed BOOLEAN NOT NULL DEFAULT FALSE,
  activated_at TIMESTAMPTZ,
  recovered_at TIMESTAMPTZ,
  passed_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (production_traffic_changed = FALSE),
  CHECK (production_cutover_performed = FALSE),
  CHECK (status <> 'monitoring' OR (activated_at IS NOT NULL AND rollback_deadline IS NOT NULL)),
  CHECK (status <> 'passed' OR passed_at IS NOT NULL),
  CHECK (status <> 'rolled_back' OR rolled_back_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS website_staging_edge_one_active_globally
  ON website_staging_edge_runs ((TRUE))
  WHERE status IN ('applying', 'monitoring');
CREATE INDEX IF NOT EXISTS website_staging_edge_runs_canary_idx
  ON website_staging_edge_runs(canary_execution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS website_staging_edge_runs_website_created_idx
  ON website_staging_edge_runs(website_id, created_at DESC);
CREATE INDEX IF NOT EXISTS website_staging_edge_runs_status_idx
  ON website_staging_edge_runs(status);

CREATE TABLE IF NOT EXISTS website_staging_edge_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES website_staging_edge_runs(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'requested', 'caddy_validated', 'caddy_reloaded', 'health_passed',
    'monitor_tick', 'monitor_recovered', 'health_failed',
    'automatic_rollback', 'manual_rollback', 'passed', 'execution_blocked'
  )),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS website_staging_edge_events_run_created_idx
  ON website_staging_edge_events(run_id, created_at ASC);

-- Step 14 may move traffic only on an isolated staging edge. The schema hard-locks
-- both production flags to FALSE. Any production-capable adapter requires a later,
-- explicit database contract and must not reuse this staging-only state.
