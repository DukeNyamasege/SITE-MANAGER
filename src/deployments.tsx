import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WebsiteRecord } from './websites';
import './deployments.css';

type Readiness = {
  website: { id: string; name: string; site_key: string; status: string; deployment_status: string };
  primary_domain?: { hostname: string } | null;
  callback_url: string;
  checks: Record<string, boolean>;
  deployment_ready: boolean;
  billing_required: false;
};

type Deployment = {
  id: string;
  hostname: string;
  runtime_name: string;
  runtime_release: string;
  contract_version: number;
  publish_mode: 'plan' | 'apply';
  status: string;
  healthcheck_url?: string | null;
  failure_message?: string | null;
  created_at: string;
  prepared_at?: string | null;
  activated_at?: string | null;
};

type Payload = {
  readiness?: Readiness;
  deployments?: Deployment[];
  publisher?: {
    mode: 'plan' | 'apply';
    contract_version: number;
    runtime: string;
    runtime_release: string;
    shared_runtime_dir: string;
    api_upstream: string;
  };
  websites?: WebsiteRecord[];
  deployment?: Deployment;
  message?: string;
  live?: boolean;
};

async function request(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let payload: Payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(payload.message || 'Deployment request failed.');
  return payload;
}

const human = (value: string) => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function DeploymentsWorkspace({ initialWebsiteId = '' }: { initialWebsiteId?: string }) {
  const [websites, setWebsites] = useState<WebsiteRecord[]>([]);
  const [selectedId, setSelectedId] = useState(initialWebsiteId);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadWebsites = useCallback(async () => {
    const result = await request('/api/v2/websites');
    const list = result.websites || [];
    setWebsites(list);
    setSelectedId(current => current || initialWebsiteId || list[0]?.id || '');
  }, [initialWebsiteId]);

  const load = useCallback(async (websiteId: string) => {
    if (!websiteId) { setPayload(null); return; }
    setPayload(await request(`/api/v2/deployments/${websiteId}`));
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadWebsites().catch(err => { if (active) setError(err instanceof Error ? err.message : String(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadWebsites]);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    load(selectedId).catch(err => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false));
  }, [selectedId, load]);

  const publish = async () => {
    if (!selectedId || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request(`/api/v2/deployments/${selectedId}/publish`, { method: 'POST', body: '{}' });
      setMessage(result.message || (result.live ? 'Website is live.' : 'Deployment plan prepared.'));
      await load(selectedId);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  const selected = websites.find(item => item.id === selectedId);
  const readiness = payload?.readiness;
  const checks = useMemo(() => readiness ? [
    ['configuration_complete', 'Configuration complete'],
    ['preview_approved', 'Real nnn preview approved'],
    ['hostname_selected', 'Primary hostname selected'],
    ['ownership_verified', 'Domain ownership verified'],
    ['routing_ready', 'DNS routes to VPS'],
    ['ssl_eligible', 'HTTPS eligible'],
    ['deriv_client_configured', 'Deriv Client/App ID configured'],
  ] as const : [], [readiness]);

  return <div className="deployments-page">
    <section className="deployments-heading">
      <div><p>STEP 7 · SHARED VPS PUBLISHING</p><h2>Deployments</h2><span>Every customer hostname serves the same nnn build. Site Manager publishes routing state and runtime identity, not a separate application copy.</span></div>
      <label>Website<select value={selectedId} onChange={event => setSelectedId(event.target.value)}>{!websites.length && <option value="">No websites</option>}{websites.map(site => <option key={site.id} value={site.id}>{site.name} · {site.site_key}</option>)}</select></label>
    </section>

    {error && <div className="deployments-alert error">{error}</div>}
    {message && <div className="deployments-alert success">{message}</div>}

    {!selected ? <section className="deployments-empty"><h3>Create a website first.</h3></section> : <>
      <section className="deployments-grid">
        <article className="deployment-card"><p>SHARED RUNTIME</p><h3>{payload?.publisher?.runtime || 'nnn'}</h3><strong>{payload?.publisher?.runtime_release || 'Not configured'}</strong><span>{payload?.publisher?.shared_runtime_dir || 'Shared VPS build path not configured'}</span></article>
        <article className="deployment-card"><p>PUBLISHER MODE</p><h3>{payload?.publisher?.mode === 'apply' ? 'VPS Apply' : 'Plan only'}</h3><strong>Contract v{payload?.publisher?.contract_version || 2}</strong><span>{payload?.publisher?.mode === 'apply' ? 'A successful publish may activate Caddy and HTTPS.' : 'Safe development mode: manifests/routes are prepared but the site is not marked live.'}</span></article>
        <article className="deployment-card"><p>PRIMARY HOSTNAME</p><h3>{readiness?.primary_domain?.hostname || 'Not selected'}</h3><strong>{readiness?.callback_url || 'Callback pending'}</strong><span>Payment is not part of this publishing gate.</span></article>
      </section>

      {readiness && <section className={`deployment-readiness ${readiness.deployment_ready ? 'ready' : ''}`}>
        <div><p>TECHNICAL GATE</p><h3>{readiness.deployment_ready ? 'Ready to publish' : 'Not ready to publish'}</h3></div>
        <div className="deployment-checks">{checks.map(([key, text]) => <span className={readiness.checks[key] ? 'done' : ''} key={key}>{readiness.checks[key] ? '✓' : '○'} {text}</span>)}</div>
        <button className="v2-primary-button" type="button" disabled={!readiness.deployment_ready || busy} onClick={() => void publish()}>{busy ? 'Publishing…' : payload?.publisher?.mode === 'apply' ? 'Publish to VPS' : 'Prepare deployment plan'}</button>
      </section>}

      <section className="deployment-history"><div><p>DEPLOYMENT HISTORY</p><h3>{payload?.deployments?.length || 0} version(s)</h3></div>{!payload?.deployments?.length ? <div className="deployments-empty compact">No deployment has been prepared yet.</div> : payload.deployments.map(item => <article key={item.id}><div><strong>{item.hostname}</strong><small>{item.id}</small></div><span className={`deployment-status ${item.status}`}>{human(item.status)}</span><div><span>Runtime {item.runtime_release}</span><span>Mode {item.publish_mode}</span><span>{new Date(item.created_at).toLocaleString()}</span>{item.failure_message && <em>{item.failure_message}</em>}</div></article>)}</section>
    </>}
  </div>;
}
