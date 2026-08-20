CREATE TABLE IF NOT EXISTS website_canary_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL UNIQUE REFERENCES website_cutover_plans(id) ON DELETE RESTRICT,
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  legacy_import_id UUID NOT NULL REFERENCES legacy_nnn_site_imports(id) ON DELETE RESTRICT,
  requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL DEFAULT 'simulate' CHECK (mode = 'simulate'),
  status TEXT NOT NULL DEFAULT 'activating' CHECK (status IN ('activating', 'monitoring', 'passed', 'rolled_back', 'failed')),
  execution_fingerprint CHAR(64) NOT NULL UNIQUE,
  primary_hostname TEXT NOT NULL,
  held_runtime_commit CHAR(40) NOT NULL,
  route_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  rollback_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  health_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  rollback_window_minutes INTEGER NOT NULL CHECK (rollback_window_minutes BETWEEN 5 AND 240),
  rollback_deadline TIMESTAMPTZ,
  automatic_rollback BOOLEAN NOT NULL DEFAULT FALSE,
  production_traffic_changed BOOLEAN NOT NULL DEFAULT FALSE,
  production_cutover_performed BOOLEAN NOT NULL DEFAULT FALSE,
  activated_at TIMESTAMPTZ,
  health_verified_at TIMESTAMPTZ,
  passed_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (production_traffic_changed = FALSE),
  CHECK (production_cutover_performed = FALSE),
  CHECK (status <> 'monitoring' OR (activated_at IS NOT NULL AND health_verified_at IS NOT NULL AND rollback_deadline IS NOT NULL)),
  CHECK (status <> 'passed' OR passed_at IS NOT NULL),
  CHECK (status <> 'rolled_back' OR rolled_back_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS website_canary_executions_one_active_globally
  ON website_canary_executions ((TRUE))
  WHERE status IN ('activating', 'monitoring');
CREATE INDEX IF NOT EXISTS website_canary_executions_website_created_idx
  ON website_canary_executions(website_id, created_at DESC);
CREATE INDEX IF NOT EXISTS website_canary_executions_status_idx
  ON website_canary_executions(status);

CREATE TABLE IF NOT EXISTS website_canary_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES website_canary_executions(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'requested', 'activated', 'health_passed', 'health_failed',
    'automatic_rollback', 'manual_rollback', 'passed', 'execution_blocked'
  )),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS website_canary_events_execution_created_idx
  ON website_canary_events(execution_id, created_at ASC);

-- Step 13 is a rehearsal contract only. The database accepts only mode=simulate,
-- permits only one active canary globally and hard-locks both production traffic
-- and production cutover flags to FALSE. A later migration must explicitly add
-- any real/apply execution state after the canary rollback drill has passed.
