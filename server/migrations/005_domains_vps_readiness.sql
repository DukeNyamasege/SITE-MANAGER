ALTER TABLE websites
  ADD COLUMN IF NOT EXISTS preview_approved_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS website_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('platform', 'custom')),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  ownership_status TEXT NOT NULL DEFAULT 'pending' CHECK (ownership_status IN ('not_required', 'pending', 'verified', 'failed')),
  routing_status TEXT NOT NULL DEFAULT 'pending' CHECK (routing_status IN ('pending', 'ready', 'error')),
  ssl_status TEXT NOT NULL DEFAULT 'pending' CHECK (ssl_status IN ('pending', 'eligible', 'provisioned', 'error')),
  verification_token TEXT,
  verification_record_name TEXT,
  verification_record_value TEXT,
  last_checked_at TIMESTAMPTZ,
  ownership_verified_at TIMESTAMPTZ,
  routing_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(hostname)
);

CREATE INDEX IF NOT EXISTS website_domains_website_id_idx ON website_domains(website_id);
CREATE INDEX IF NOT EXISTS website_domains_hostname_lower_idx ON website_domains(LOWER(hostname));
CREATE UNIQUE INDEX IF NOT EXISTS website_domains_one_primary_per_site
  ON website_domains(website_id)
  WHERE is_primary = TRUE;

-- Billing is intentionally not part of domain or deployment readiness.
-- Payment activation will be designed only after the full website lifecycle is working.
