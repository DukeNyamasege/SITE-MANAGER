export type Domain = {
  id: string;
  display_domain: string;
  website_url: string;
  redirect_uri?: string;
  client_id?: string;
  scopes?: string[];
  environment?: 'production' | 'staging' | string;
  legacy_app_id?: string;
};

export type BotMeta = {
  id?: string;
  name?: string;
  title?: string;
  file: string;
  asset?: string;
  encoding?: 'gzip-base64';
  description?: string;
  emoji?: string;
  is_premium?: boolean;
  priority?: number;
  guide?: string;
};

export type ExistingItem = {
  kind: 'existing';
  bot: BotMeta;
};

export type UploadItem = {
  kind: 'upload';
  temp_id: string;
  file_name: string;
  name: string;
  xml: string;
};

export type ManagerItem = ExistingItem | UploadItem;

export type BotsResponse = {
  site: Domain;
  source: 'domain' | 'shared';
  inherited: boolean;
  bots: BotMeta[];
};

export type NavigationFeature = {
  id: string;
  label: string;
  required?: boolean;
};

export type ThemeColors = {
  primary: string;
  secondary: string;
  nav_background: string;
  nav_text: string;
  header_background: string;
};

export type SiteSettingsResponse = {
  site: Domain;
  inherited: boolean;
  catalog: NavigationFeature[];
  navigation: string[];
  colors: ThemeColors;
};

export type DomainsResponse = {
  domains: Domain[];
  onboarding?: boolean;
};

export type LoginResponse = {
  ok: boolean;
  mode: 'manage' | 'provision';
  site: Domain;
  message?: string;
};

export type OnboardingResponse = {
  status: 'draft' | 'configured';
  site: Domain;
  catalog?: NavigationFeature[];
  navigation?: string[];
  colors?: ThemeColors;
  recommended_scopes?: string[];
  optional_scopes?: string[];
  infrastructure?: {
    netlify_automation: boolean;
    dns_automation: boolean;
  };
};

export type DomainVerificationResponse = {
  verified: boolean;
  domain: string;
  method?: 'namecheap-account' | 'dns-txt' | string;
  message?: string;
  automatic_namecheap_check?: boolean;
  record?: {
    name: string;
    host: string;
    type: 'TXT' | string;
    value: string;
  };
};

export type PublishResponse = {
  status: 'pending' | 'no_changes' | 'already_configured';
  pr?: number;
  head_sha?: string;
  branch?: string;
  message?: string;
  site?: Domain;
};

export type PublishStatusResponse = {
  status: 'pending' | 'failed' | 'merged';
  message: string;
  merge_sha?: string;
  workflow_url?: string;
};

export type InfrastructureResponse = {
  status: 'needs_configuration' | 'dns_required' | 'domain_connected';
  message: string;
  domain: string;
  netlify?: {
    site_id: string;
    hostname: string;
    aliases_added: string[];
  };
  dns?: {
    configured?: boolean;
    status?: string;
    message?: string;
    [key: string]: unknown;
  };
  dns_records?: {
    apex: { type: string; host: string; value: string };
    apex_fallback: { type: string; host: string; value: string };
    www: { type: string; host: string; value: string };
  };
  ssl?: { status: string; message?: string };
};
