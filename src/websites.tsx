import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import './websites.css';

export type WebsiteSubscription = {
  id: string;
  price_cents: number;
  currency: string;
  billing_status: string;
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  current_period_started_at?: string | null;
  current_period_ends_at?: string | null;
};

export type WebsiteRecord = {
  id: string;
  name: string;
  site_key: string;
  template_id: string;
  source: 'created' | 'migrated' | string;
  status: 'draft' | 'configuring' | 'ready' | 'deploying' | 'live' | 'suspended' | 'archived' | string;
  primary_domain?: string | null;
  domain_status: string;
  deployment_status: string;
  created_at: string;
  updated_at: string;
  subscription: WebsiteSubscription;
};

type WebsiteResponse = { website?: WebsiteRecord; websites?: WebsiteRecord[]; message?: string; ok?: boolean };

class WebsiteApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message || 'Website request failed.');
    this.status = status;
  }
}

async function websiteRequest(path = '', options: RequestInit = {}) {
  const response = await fetch(`/api/v2/websites${path ? `/${path}` : ''}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let payload: WebsiteResponse = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new WebsiteApiError(response.status, payload.message || 'Website request failed.');
  return payload;
}

function formatDate(value?: string | null) {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
}

function statusLabel(value: string) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

export function MyWebsitesView({
  onCreateWebsite,
  onContinueSetup,
  onPreviewWebsite,
  onManageDomains,
}: {
  onCreateWebsite: () => void;
  onContinueSetup: (website: WebsiteRecord) => void;
  onPreviewWebsite: (website: WebsiteRecord) => void;
  onManageDomains: (website: WebsiteRecord) => void;
}) {
  const [websites, setWebsites] = useState<WebsiteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [renamingId, setRenamingId] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setError('');
    const result = await websiteRequest();
    setWebsites(result.websites || []);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load().catch(err => { if (active) setError(err instanceof Error ? err.message : String(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  const summary = useMemo(() => ({
    total: websites.length,
    live: websites.filter(site => site.status === 'live').length,
    deployed: websites.filter(site => site.deployment_status === 'deployed').length,
    connectedDomains: websites.filter(site => site.domain_status === 'connected').length,
  }), [websites]);

  const saveRename = async (website: WebsiteRecord) => {
    const name = renameValue.trim();
    if (!name || name === website.name) { setRenamingId(''); return; }
    setBusyId(website.id); setError('');
    try {
      const result = await websiteRequest(website.id, { method: 'PATCH', body: JSON.stringify({ name }) });
      if (result.website) setWebsites(current => current.map(item => item.id === website.id ? result.website! : item));
      setRenamingId('');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusyId(''); }
  };

  const archive = async (website: WebsiteRecord) => {
    if (!window.confirm(`Archive ${website.name}? It will be removed from My Websites but retained in the database for history.`)) return;
    setBusyId(website.id); setError('');
    try {
      await websiteRequest(`${website.id}/archive`, { method: 'POST', body: '{}' });
      setWebsites(current => current.filter(item => item.id !== website.id));
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusyId(''); }
  };

  if (loading) return <section className="websites-loading">Loading your websites…</section>;

  return <div className="websites-page">
    <section className="websites-heading"><div><p>OWNED WEBSITES</p><h2>My Websites</h2><span>Every new website starts by securing its custom domain. Existing websites continue normally.</span></div><button className="v2-primary-button" type="button" onClick={onCreateWebsite}>+ Create website</button></section>
    {error && <div className="websites-alert error">{error}</div>}
    <section className="website-stat-grid"><article><strong>{summary.total}</strong><span>Total websites</span></article><article><strong>{summary.live}</strong><span>Live</span></article><article><strong>{summary.deployed}</strong><span>Deployed</span></article><article><strong>{summary.connectedDomains}</strong><span>Domains connected</span></article></section>

    {!websites.length ? <section className="websites-empty"><div className="websites-empty-icon">⌕</div><p>NO WEBSITES YET</p><h3>Start by securing the domain you actually want.</h3><span>Check availability and premium pricing first. Buy the domain, prove ownership, and only then Site Manager unlocks your first website setup.</span><button className="v2-primary-button" type="button" onClick={onCreateWebsite}>Find my domain</button></section> : <section className="website-card-grid">
      {websites.map(website => <article className="website-card" key={website.id}>
        <div className="website-card-top"><div className="website-icon">W</div><div className="website-title">{renamingId === website.id ? <div className="website-rename-row"><input value={renameValue} onChange={event => setRenameValue(event.target.value)} maxLength={100} autoFocus /><button type="button" disabled={busyId === website.id} onClick={() => void saveRename(website)}>Save</button><button type="button" onClick={() => setRenamingId('')}>Cancel</button></div> : <><h3>{website.name}</h3><small>{website.site_key}</small></>}</div><span className={`website-status ${website.status === 'live' ? 'live' : ''}`}>{statusLabel(website.status)}</span></div>
        <div className="website-facts"><div><span>Template</span><strong>{website.template_id}</strong></div><div><span>Primary hostname</span><strong>{website.primary_domain || 'Not selected'}</strong></div><div><span>Deployment</span><strong>{statusLabel(website.deployment_status)}</strong></div><div><span>Created</span><strong>{formatDate(website.created_at)}</strong></div></div>
        <div className="website-billing-strip"><span>PAYMENT</span><strong>Deferred until the website lifecycle is complete</strong></div>
        <div className="website-actions"><button type="button" onClick={() => { setRenamingId(website.id); setRenameValue(website.name); }}>Rename</button><button type="button" disabled={busyId === website.id} onClick={() => void archive(website)}>Archive</button><button type="button" onClick={() => onPreviewWebsite(website)}>Preview & assets</button><button type="button" onClick={() => onManageDomains(website)}>Domains & readiness</button><button className="primary" type="button" onClick={() => onContinueSetup(website)}>{website.status === 'ready' ? 'Edit setup' : 'Continue setup'}</button></div>
      </article>)}
    </section>}
  </div>;
}

function defaultWebsiteName(hostname: string) {
  const first = hostname.split('.')[0] || 'My Website';
  return first.replace(/[-_]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

export function CreateWebsiteView({
  domainOnboardingId,
  domainHostname,
  onCreated,
  onCancel,
}: {
  domainOnboardingId: string;
  domainHostname: string;
  onCreated: (website: WebsiteRecord) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(() => defaultWebsiteName(domainHostname));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const result = await websiteRequest('', {
        method: 'POST',
        body: JSON.stringify({ name, domain_onboarding_id: domainOnboardingId }),
      });
      if (!result.website) throw new Error('The website record was not returned.');
      onCreated(result.website);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  return <div className="website-create-page"><section className="website-create-card"><p className="v2-kicker">DOMAIN VERIFIED · STEP 2</p><h2>Now create the website behind your domain.</h2><p>Your domain is already secured and ownership-verified. Site Manager will attach it automatically as the primary custom domain, then open the nnn template builder.</p><div className="website-create-domain"><div><span>VERIFIED DOMAIN</span><strong>{domainHostname}</strong></div><div><span>NEXT</span><strong>Branding + Deriv configuration</strong></div></div><form onSubmit={submit}><label>Website / brand name<input value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={100} placeholder="Example: Duke" autoFocus /></label><div className="website-create-preview"><span>Template</span><strong>nnn</strong><span>Starting status</span><strong>Draft</strong><span>Primary domain</span><strong>{domainHostname}</strong><span>Payment required now?</span><strong>No — designed later</strong></div>{error && <div className="websites-alert error">{error}</div>}<div className="website-create-actions"><button type="button" onClick={onCancel}>Back to domain</button><button className="v2-primary-button" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create & configure website'}</button></div></form></section></div>;
}
