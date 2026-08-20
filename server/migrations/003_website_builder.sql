CREATE TABLE IF NOT EXISTS website_configs (
  website_id UUID PRIMARY KEY REFERENCES websites(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL DEFAULT '',
  tagline TEXT NOT NULL DEFAULT 'SMART DERIV TOOLS',
  logo_url TEXT,
  navigation JSONB NOT NULL DEFAULT '["dashboard","bot_builder","free_bots","auto_trader","manual_trading","tradingview","bulk_trader","batch_trader","speedbot","copy_trading","analysis_tools","calculator"]'::jsonb,
  colors JSONB NOT NULL DEFAULT '{"primary":"#059669","secondary":"#19cba3","nav_background":"#151d26","nav_text":"#f3f6f8","header_background":"#ffffff"}'::jsonb,
  deriv_client_id TEXT,
  deriv_scopes JSONB NOT NULL DEFAULT '["trade","application_read"]'::jsonb,
  deriv_environment TEXT NOT NULL DEFAULT 'production' CHECK (deriv_environment IN ('production', 'staging')),
  setup_step INTEGER NOT NULL DEFAULT 1 CHECK (setup_step BETWEEN 1 AND 5),
  configuration_status TEXT NOT NULL DEFAULT 'draft' CHECK (configuration_status IN ('draft', 'in_progress', 'complete')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS website_configs_configuration_status_idx ON website_configs(configuration_status);

INSERT INTO website_configs (website_id, brand_name)
SELECT w.id, w.name
  FROM websites w
  LEFT JOIN website_configs c ON c.website_id = w.id
 WHERE c.website_id IS NULL;
