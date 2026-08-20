CREATE TABLE IF NOT EXISTS website_preview_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS website_preview_sessions_website_id_idx ON website_preview_sessions(website_id);
CREATE INDEX IF NOT EXISTS website_preview_sessions_expires_at_idx ON website_preview_sessions(expires_at);
