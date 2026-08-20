CREATE TABLE IF NOT EXISTS legacy_nnn_parity_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_import_id UUID NOT NULL UNIQUE REFERENCES legacy_nnn_site_imports(id) ON DELETE CASCADE,
  website_id UUID NOT NULL UNIQUE REFERENCES websites(id) ON DELETE CASCADE,
  report_version INTEGER NOT NULL DEFAULT 1 CHECK (report_version = 1),
  legacy_source_commit CHAR(40) NOT NULL,
  legacy_source_fingerprint CHAR(64) NOT NULL,
  held_runtime_commit CHAR(40) NOT NULL,
  runtime_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  checks JSONB NOT NULL DEFAULT '{}'::jsonb,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'blocked' CHECK (status IN ('blocked', 'parity_ready', 'stale')),
  production_cutover_performed BOOLEAN NOT NULL DEFAULT FALSE,
  ready_at TIMESTAMPTZ,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (production_cutover_performed = FALSE),
  CHECK ((status = 'parity_ready') = (ready_at IS NOT NULL))
);

CREATE OR REPLACE FUNCTION invalidate_preview_approval_on_config_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    UPDATE websites
       SET preview_approved_at = NULL,
           updated_at = NOW()
     WHERE id = NEW.website_id
       AND preview_approved_at IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS website_configs_invalidate_preview_approval ON website_configs;
CREATE TRIGGER website_configs_invalidate_preview_approval
AFTER UPDATE ON website_configs
FOR EACH ROW
EXECUTE FUNCTION invalidate_preview_approval_on_config_change();

CREATE INDEX IF NOT EXISTS legacy_nnn_parity_reports_status_idx
  ON legacy_nnn_parity_reports(status);
CREATE INDEX IF NOT EXISTS legacy_nnn_parity_reports_checked_at_idx
  ON legacy_nnn_parity_reports(checked_at DESC);

-- Step 11 is evidence only. A parity-ready report does not activate routing,
-- create a production deployment, start billing, or modify nnn/main. Future
-- cutover work must use a separate migration to relax the explicit FALSE guard.
