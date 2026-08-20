CREATE TABLE IF NOT EXISTS website_production_eligibility (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
    legacy_import_id UUID NOT NULL REFERENCES legacy_nnn_site_imports(id) ON DELETE CASCADE,
    parity_report_id UUID NOT NULL REFERENCES legacy_nnn_parity_reports(id) ON DELETE RESTRICT,
    cutover_plan_id UUID NOT NULL REFERENCES website_cutover_plans(id) ON DELETE RESTRICT,
    canary_execution_id UUID NOT NULL REFERENCES website_canary_executions(id) ON DELETE RESTRICT,
    staging_edge_run_id UUID NOT NULL REFERENCES website_staging_edge_runs(id) ON DELETE RESTRICT,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approved_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('eligible', 'approved', 'invalidated', 'expired', 'revoked')),
    production_eligibility_contract_version INTEGER NOT NULL DEFAULT 1 CHECK (production_eligibility_contract_version = 1),
    evidence_fingerprint CHAR(64) NOT NULL,
    legacy_source_commit CHAR(40) NOT NULL,
    legacy_source_fingerprint CHAR(64) NOT NULL,
    held_runtime_commit CHAR(40) NOT NULL,
    v2_fingerprint CHAR(64) NOT NULL,
    primary_hostname TEXT NOT NULL,
    checks JSONB NOT NULL DEFAULT '{}'::jsonb,
    evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    rollback_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    eligible_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    approved_at TIMESTAMPTZ,
    invalidated_at TIMESTAMPTZ,
    invalidated_reason TEXT,
    production_traffic_changed BOOLEAN NOT NULL DEFAULT FALSE CHECK (production_traffic_changed = FALSE),
    production_cutover_performed BOOLEAN NOT NULL DEFAULT FALSE CHECK (production_cutover_performed = FALSE),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS website_production_eligibility_one_actionable_per_site
    ON website_production_eligibility (website_id)
    WHERE status IN ('eligible', 'approved');

CREATE INDEX IF NOT EXISTS website_production_eligibility_website_idx
    ON website_production_eligibility (website_id, created_at DESC);

CREATE INDEX IF NOT EXISTS website_production_eligibility_staging_idx
    ON website_production_eligibility (staging_edge_run_id);

CREATE TABLE IF NOT EXISTS website_production_eligibility_events (
    id BIGSERIAL PRIMARY KEY,
    eligibility_id UUID NOT NULL REFERENCES website_production_eligibility(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS website_production_eligibility_events_idx
    ON website_production_eligibility_events (eligibility_id, created_at);

CREATE OR REPLACE FUNCTION protect_production_eligibility_evidence()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.website_id IS DISTINCT FROM OLD.website_id
       OR NEW.legacy_import_id IS DISTINCT FROM OLD.legacy_import_id
       OR NEW.parity_report_id IS DISTINCT FROM OLD.parity_report_id
       OR NEW.cutover_plan_id IS DISTINCT FROM OLD.cutover_plan_id
       OR NEW.canary_execution_id IS DISTINCT FROM OLD.canary_execution_id
       OR NEW.staging_edge_run_id IS DISTINCT FROM OLD.staging_edge_run_id
       OR NEW.production_eligibility_contract_version IS DISTINCT FROM OLD.production_eligibility_contract_version
       OR NEW.evidence_fingerprint IS DISTINCT FROM OLD.evidence_fingerprint
       OR NEW.legacy_source_commit IS DISTINCT FROM OLD.legacy_source_commit
       OR NEW.legacy_source_fingerprint IS DISTINCT FROM OLD.legacy_source_fingerprint
       OR NEW.held_runtime_commit IS DISTINCT FROM OLD.held_runtime_commit
       OR NEW.v2_fingerprint IS DISTINCT FROM OLD.v2_fingerprint
       OR NEW.primary_hostname IS DISTINCT FROM OLD.primary_hostname
       OR NEW.checks IS DISTINCT FROM OLD.checks
       OR NEW.evidence_snapshot IS DISTINCT FROM OLD.evidence_snapshot
       OR NEW.rollback_snapshot IS DISTINCT FROM OLD.rollback_snapshot
       OR NEW.eligible_at IS DISTINCT FROM OLD.eligible_at
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.production_traffic_changed IS DISTINCT FROM OLD.production_traffic_changed
       OR NEW.production_cutover_performed IS DISTINCT FROM OLD.production_cutover_performed THEN
        RAISE EXCEPTION 'Production eligibility evidence is immutable; create a new record after evidence changes.';
    END IF;
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS website_production_eligibility_immutable ON website_production_eligibility;
CREATE TRIGGER website_production_eligibility_immutable
BEFORE UPDATE ON website_production_eligibility
FOR EACH ROW EXECUTE FUNCTION protect_production_eligibility_evidence();
