CREATE TABLE IF NOT EXISTS domain_onboarding_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL,
  registrar TEXT NOT NULL DEFAULT 'namecheap' CHECK (registrar IN ('namecheap', 'other')),
  status TEXT NOT NULL DEFAULT 'searched' CHECK (status IN ('searched', 'purchase_confirmed', 'verified', 'claimed', 'abandoned')),
  availability_status TEXT NOT NULL DEFAULT 'unknown' CHECK (availability_status IN ('unknown', 'available', 'registered')),
  availability_source TEXT NOT NULL DEFAULT 'unknown',
  is_premium BOOLEAN,
  premium_registration_price NUMERIC(14,2),
  premium_renewal_price NUMERIC(14,2),
  price_currency TEXT,
  price_note TEXT,
  purchase_status TEXT NOT NULL DEFAULT 'not_started' CHECK (purchase_status IN ('not_started', 'confirmed')),
  ownership_status TEXT NOT NULL DEFAULT 'pending' CHECK (ownership_status IN ('pending', 'verified')),
  verification_token TEXT NOT NULL,
  verification_record_name TEXT NOT NULL,
  verification_record_value TEXT NOT NULL,
  checked_at TIMESTAMPTZ,
  purchase_confirmed_at TIMESTAMPTZ,
  ownership_verified_at TIMESTAMPTZ,
  last_ownership_check_at TIMESTAMPTZ,
  claimed_website_id UUID REFERENCES websites(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, hostname)
);

CREATE UNIQUE INDEX IF NOT EXISTS domain_onboarding_one_verified_owner_per_hostname
  ON domain_onboarding_intents(LOWER(hostname))
  WHERE ownership_status = 'verified' AND status <> 'abandoned';

CREATE UNIQUE INDEX IF NOT EXISTS domain_onboarding_claimed_website_unique
  ON domain_onboarding_intents(claimed_website_id)
  WHERE claimed_website_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS domain_onboarding_user_created_idx
  ON domain_onboarding_intents(user_id, created_at DESC);

-- A brand-new V2 website must consume one verified domain onboarding intent.
-- Existing/migrated websites are intentionally not retroactively constrained.
