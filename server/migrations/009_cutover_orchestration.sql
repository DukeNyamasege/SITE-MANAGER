CREATE TABLE IF NOT EXISTS website_cutover_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  legacy_import_id UUID NOT NULL REFERENCES legacy_nnn_site_imports(id) ON DELETE CASCADE,
  parity_report_id UUID NOT NULL REFERENCES legacy_nnn_parity_reports(id) ON DELETE RESTRICT,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  armed_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  plan_version INTEGER NOT NULL DEFAULT 1 CHECK (plan_version = 1),
  cutover_contract_version INTEGER NOT NULL DEFAULT 1 CHECK (cutover_contract_version = 1),
  status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'armed', 'invalidated', 'cancelled', 'expired')),
  primary_hostname TEXT NOT NULL,
  legacy_source_commit CHAR(40) NOT NULL,
  legacy_source_fingerprint CHAR(64) NOT NULL,
  held_runtime_commit CHAR(40) NOT NULL,
  v2_fingerprint CHAR(64) NOT NULL,
  parity_snapshot JSONB NOT NULL,
  runtime_snapshot JSONB NOT NULL,
  rollback_snapshot JSONB NOT NULL,
  preflight_snapshot JSONB NOT NULL,
  plan_fingerprint CHAR(64) NOT NULL UNIQUE,
  rollback_window_minutes INTEGER NOT NULL DEFAULT 30 CHECK (rollback_window_minutes BETWEEN 5 AND 240),
  expires_at TIMESTAMPTZ NOT NULL,
  armed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  invalidation_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  production_cutover_performed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (production_cutover_performed = FALSE),
  CHECK (status <> 'armed' OR armed_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS website_cutover_plans_one_open_per_site
  ON website_cutover_plans(website_id)
  WHERE status IN ('prepared', 'armed');
CREATE INDEX IF NOT EXISTS website_cutover_plans_website_created_idx
  ON website_cutover_plans(website_id, created_at DESC);
CREATE INDEX IF NOT EXISTS website_cutover_plans_status_idx
  ON website_cutover_plans(status);

CREATE TABLE IF NOT EXISTS website_cutover_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES website_cutover_plans(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('prepared', 'armed', 'invalidated', 'expired', 'cancelled', 'execution_blocked')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS website_cutover_events_plan_created_idx
  ON website_cutover_events(plan_id, created_at ASC);

CREATE OR REPLACE FUNCTION protect_cutover_plan_snapshot()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.website_id IS DISTINCT FROM OLD.website_id
     OR NEW.legacy_import_id IS DISTINCT FROM OLD.legacy_import_id
     OR NEW.parity_report_id IS DISTINCT FROM OLD.parity_report_id
     OR NEW.plan_version IS DISTINCT FROM OLD.plan_version
     OR NEW.cutover_contract_version IS DISTINCT FROM OLD.cutover_contract_version
     OR NEW.primary_hostname IS DISTINCT FROM OLD.primary_hostname
     OR NEW.legacy_source_commit IS DISTINCT FROM OLD.legacy_source_commit
     OR NEW.legacy_source_fingerprint IS DISTINCT FROM OLD.legacy_source_fingerprint
     OR NEW.held_runtime_commit IS DISTINCT FROM OLD.held_runtime_commit
     OR NEW.v2_fingerprint IS DISTINCT FROM OLD.v2_fingerprint
     OR NEW.parity_snapshot IS DISTINCT FROM OLD.parity_snapshot
     OR NEW.runtime_snapshot IS DISTINCT FROM OLD.runtime_snapshot
     OR NEW.rollback_snapshot IS DISTINCT FROM OLD.rollback_snapshot
     OR NEW.preflight_snapshot IS DISTINCT FROM OLD.preflight_snapshot
     OR NEW.plan_fingerprint IS DISTINCT FROM OLD.plan_fingerprint
     OR NEW.rollback_window_minutes IS DISTINCT FROM OLD.rollback_window_minutes
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.production_cutover_performed IS DISTINCT FROM OLD.production_cutover_performed THEN
    RAISE EXCEPTION 'Cutover evidence snapshots are immutable; create a new plan after any evidence change.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS website_cutover_plans_protect_snapshot ON website_cutover_plans;
CREATE TRIGGER website_cutover_plans_protect_snapshot
BEFORE UPDATE ON website_cutover_plans
FOR EACH ROW
EXECUTE FUNCTION protect_cutover_plan_snapshot();

-- Step 12 prepares and arms immutable plans only. No row in this migration can
-- represent a completed production cutover. Traffic execution remains a later,
-- explicitly introduced contract and billing remains outside the cutover gate.
