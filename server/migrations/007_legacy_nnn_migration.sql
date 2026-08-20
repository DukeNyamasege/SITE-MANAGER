ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'customer';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'admin'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS legacy_nnn_site_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_site_id TEXT NOT NULL UNIQUE,
  source_repository TEXT NOT NULL DEFAULT 'DukeNyamasege/nnn',
  source_commit CHAR(40) NOT NULL,
  source_registry_sha TEXT,
  display_domain TEXT NOT NULL,
  hosts JSONB NOT NULL DEFAULT '[]'::jsonb,
  website_url TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  deriv_client_id TEXT NOT NULL,
  deriv_scopes JSONB NOT NULL DEFAULT '["trade","application_read"]'::jsonb,
  deriv_environment TEXT NOT NULL DEFAULT 'production' CHECK (deriv_environment IN ('production', 'staging')),
  customization JSONB NOT NULL,
  customization_source TEXT NOT NULL CHECK (customization_source IN ('explicit', 'inherited_defaults')),
  free_bot_manifest_path TEXT,
  free_bot_manifest_sha TEXT,
  source_snapshot JSONB NOT NULL,
  source_fingerprint CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'unassigned' CHECK (status IN ('unassigned', 'assigned', 'ignored', 'error')),
  assigned_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  website_id UUID UNIQUE REFERENCES websites(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ,
  last_audited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status = 'assigned') = (assigned_user_id IS NOT NULL AND website_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS legacy_nnn_site_imports_status_idx ON legacy_nnn_site_imports(status);
CREATE INDEX IF NOT EXISTS legacy_nnn_site_imports_display_domain_lower_idx ON legacy_nnn_site_imports(LOWER(display_domain));
CREATE INDEX IF NOT EXISTS legacy_nnn_site_imports_assigned_user_id_idx ON legacy_nnn_site_imports(assigned_user_id);

-- Legacy nnn records are intentionally imported into a holding inventory first.
-- A domain name alone never grants ownership. Only an authenticated Site Manager
-- administrator may assign an inventory record to a verified customer account.
-- Assignment creates a V2 shadow website with the exact legacy site_key but does
-- not make it a live VPS deployment or change current nnn production traffic.
