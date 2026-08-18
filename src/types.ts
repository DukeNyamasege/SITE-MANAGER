export type Domain = {
  id: string;
  display_domain: string;
  website_url: string;
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

export type PublishResponse = {
  status: 'pending' | 'no_changes';
  pr?: number;
  head_sha?: string;
  branch?: string;
  message?: string;
};

export type PublishStatusResponse = {
  status: 'pending' | 'failed' | 'merged';
  message: string;
  merge_sha?: string;
  workflow_url?: string;
};
