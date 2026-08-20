CREATE TABLE IF NOT EXISTS websites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  site_key TEXT NOT NULL UNIQUE,
  template_id TEXT NOT NULL DEFAULT 'nnn',
  source TEXT NOT NULL DEFAULT 'created' CHECK (source IN ('created', 'migrated')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'configuring', 'ready', 'deploying', 'live', 'suspended', 'archived')),
  primary_domain TEXT,
  domain_status TEXT NOT NULL DEFAULT 'none' CHECK (domain_status IN ('none', 'pending', 'connected', 'error')),
  deployment_status TEXT NOT NULL DEFAULT 'not_deployed' CHECK (deployment_status IN ('not_deployed', 'queued', 'deploying', 'deployed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS websites_owner_user_id_idx ON websites(owner_user_id);
CREATE INDEX IF NOT EXISTS websites_status_idx ON websites(status);
CREATE UNIQUE INDEX IF NOT EXISTS websites_owner_name_lower_unique ON websites(owner_user_id, LOWER(name)) WHERE status <> 'archived';

CREATE TABLE IF NOT EXISTS website_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id UUID NOT NULL UNIQUE REFERENCES websites(id) ON DELETE CASCADE,
  price_cents INTEGER NOT NULL DEFAULT 1000 CHECK (price_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  billing_status TEXT NOT NULL DEFAULT 'not_started' CHECK (billing_status IN ('not_started', 'trialing', 'active', 'past_due', 'cancelled', 'exempt')),
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  current_period_started_at TIMESTAMPTZ,
  current_period_ends_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS website_subscriptions_billing_status_idx ON website_subscriptions(billing_status);

-- Step 3 establishes ownership and the USD 10/month plan record.
-- Step 14 will activate the free-month trial and payment-provider lifecycle when a website reaches the billing activation point.
