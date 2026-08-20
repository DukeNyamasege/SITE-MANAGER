import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { WebsiteRecord } from './websites';
import './domains.css';

type DomainRecord = {
  id: string;
  hostname: string;
  kind: 'platform' | 'custom';
  is_primary: boolean;
  ownership_status: string;
  routing_status: string;
  ssl_status: string;
  verification_record?: { type: string; name: string; value: string } | null;
  last_checked_at?: string | null;
};

type Readiness = {
  website: { id: string; name: string; site_key: string; status: string; preview_approved_at?: string | null; deployment_status: string };
  primary_domain?: DomainRecord | null;
  callback_url: string;
  deriv_environment: string;
  checks: Record<string, boolean>;
  deployment_ready: boolean;
  billing_required: false;
  billing_note: string;
};

type DomainPayload = {
  domains?: DomainRecord[];
  platform_base_domain?: string;
  routing_target?: { ipv4?: string[]; ipv6?: string[]; cname?: string };
  readiness?: Readiness;
  domain?: DomainRecord;
  message?: string;
  ownership?: { verified: boolean; message: string };
  routing?: { ready: boolean; message: string };
};

async function jsonRequest(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let payload: DomainPayload & { websites?: WebsiteRecord[] } = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(payload.message || 'Domain request failed.');
  return payload;
}

const label = (value: string) => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function DomainsWorkspace({ initialWebsiteId = '', focus = 'domains' }: { initialWebsiteId?: string; focus?: 'domains' | 'deployments' }) {
  const [websites, setWebsites] = useState<WebsiteRecord[]>([]);
  const [selectedId, setSelectedId] = useState(initialWebsiteId);
  const [payload, setPayload] = useState<DomainPayload | null>(null);
  const [hostname, setHostname] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadWebsiteList = useCallback(async () => {
    const response = await jsonRequest('/api/v2/websites');
    const list = response.websites || [];
    setWebsites(list);
    setSelectedId(current => current || initialWebsiteId || list[0]?.id || '');
  }, [initialWebsiteId]);

  const loadDomains = useCallback(async (websiteId: string) => {
    if (!websiteId) { setPayload(null); return; }
    const response = await jsonRequest(`/api/v2/domains/${websiteId}`);
    setPayload(response);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadWebsiteList()
      .catch(err => { if (active) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadWebsiteList]);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    loadDomains(selectedId)
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [selectedId, loadDomains]);

  const act = async (key: string, url: string, options: RequestInit = {}) => {
    setBusy(key); setError(''); setMessage('');
    try {
      const response = await jsonRequest(url, options);
      if (selectedId) await loadDomains(selectedId);
      setMessage(response.ownership?.message || response.routing?.message || 'Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(''); }
  };

  const addCustom = async (event: FormEvent) => {
    event.preventDefault();
    const value = hostname.trim();
    if (!value || !selectedId) return;
    setBusy('custom'); setError(''); setMessage('');
    try {
      await jsonRequest(`/api/v2/domains/${selectedId}/custom`, { method: 'POST', body: JSON.stringify({ hostname: value }) });
      setHostname('');
      await loadDomains(selectedId);
      setMessage('Custom domain added. Add the TXT record, then run Check DNS.');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(''); }
  };

  const selected = websites.find(item => item.id === selectedId);
  const readiness = payload?.readiness;
  const orderedChecks = useMemo(() => readiness ? [
    ['configuration_complete', 'Website configuration complete'],
    ['preview_approved', 'Real nnn preview approved'],
    ['hostname_selected', 'Primary hostname selected'],
    ['ownership_verified', 'Domain ownership verified'],
    ['routing_ready', 'DNS routes to the VPS'],
    ['ssl_eligible', 'HTTPS certificate eligible'],
    ['deriv_client_configured', 'Deriv Client/App ID configured'],
  ] as const : [], [readiness]);

  if (loading && !websites.length) return <section className="domains-loading">Loading domain workspace…</section>;

  return <div className="domains-page">
    <section className="domains-heading">
      <div>
        <p>{focus === 'deployments' ? 'VPS DEPLOYMENT READINESS' : 'DOMAIN CONTROL'}</p>
        <h2>{focus === 'deployments' ? 'Deployment Readiness' : 'Domains'}</h2>
        <span>Attach a custom domain or reserve a Site Manager platform address. Payment is not part of this workflow.</span>
      </div>
      <label>Website
        <select value={selectedId} onChange={event => setSelectedId(event.target.value)}>
          {!websites.length && <option value="">No websites</option>}
          {websites.map(site => <option key={site.id} value={site.id}>{site.name} · {site.site_key}</option>)}
        </select>
      </label>
    </section>

    {error && <div className="domains-alert error">{error}</div>}
    {message && <div className="domains-alert success">{message}</div>}

    {!selected ? <section className="domains-empty"><h3>Create a website first.</h3><p>Domain work starts after Site Manager has an owned website draft.</p></section> : <>
      {focus === 'deployments' && readiness && <ReadinessPanel readiness={readiness} orderedChecks={orderedChecks} />}

      <section className="domains-grid">
        <article className="domains-card">
          <p className="domains-kicker">NO DOMAIN YET</p>
          <h3>Reserve a platform address</h3>
          <p>The address uses the same shared `nnn` runtime. It can later be replaced by a custom domain without rebuilding the website.</p>
          <code>{selected.site_key}.{payload?.platform_base_domain || 'sites.example.com'}</code>
          <button className="v2-primary-button" type="button" disabled={busy === 'platform'} onClick={() => void act('platform', `/api/v2/domains/${selected.id}/platform`, { method: 'POST', body: '{}' })}>{busy === 'platform' ? 'Checking…' : 'Reserve / refresh platform address'}</button>
        </article>

        <article className="domains-card">
          <p className="domains-kicker">I OWN A DOMAIN</p>
          <h3>Connect a custom hostname</h3>
          <p>Site Manager verifies ownership using DNS TXT before the hostname can become primary.</p>
          <form onSubmit={addCustom}>
            <input value={hostname} onChange={event => setHostname(event.target.value)} placeholder="example.com or trade.example.com" />
            <button className="v2-primary-button" disabled={busy === 'custom'}>{busy === 'custom' ? 'Adding…' : 'Add domain'}</button>
          </form>
        </article>
      </section>

      <section className="domains-list">
        <div className="domains-section-title"><div><p>HOSTNAMES</p><h3>{payload?.domains?.length || 0} attached</h3></div></div>
        {!payload?.domains?.length ? <div className="domains-empty compact">No hostname has been reserved or connected yet.</div> : payload.domains.map(domain => <article className="domain-row" key={domain.id}>
          <div className="domain-main">
            <div><span className={`domain-kind ${domain.kind}`}>{domain.kind}</span>{domain.is_primary && <span className="domain-primary">PRIMARY</span>}</div>
            <h4>{domain.hostname}</h4>
            {domain.verification_record && <div className="dns-instructions">
              <strong>Ownership TXT</strong>
              <span>Name: <code>{domain.verification_record.name}</code></span>
              <span>Value: <code>{domain.verification_record.value}</code></span>
            </div>}
          </div>
          <div className="domain-states">
            <State label="Ownership" value={domain.ownership_status} good={['verified', 'not_required'].includes(domain.ownership_status)} />
            <State label="VPS routing" value={domain.routing_status} good={domain.routing_status === 'ready'} />
            <State label="HTTPS" value={domain.ssl_status} good={['eligible', 'provisioned'].includes(domain.ssl_status)} />
          </div>
          <div className="domain-actions">
            <button type="button" disabled={busy === domain.id} onClick={() => void act(domain.id, `/api/v2/domains/${selected.id}/${domain.id}/check`, { method: 'POST', body: '{}' })}>Check DNS</button>
            {!domain.is_primary && <button type="button" disabled={!['verified', 'not_required'].includes(domain.ownership_status) || busy === domain.id} onClick={() => void act(domain.id, `/api/v2/domains/${selected.id}/${domain.id}/primary`, { method: 'POST', body: '{}' })}>Make primary</button>}
          </div>
        </article>)}
      </section>

      {payload?.routing_target && <section className="domains-routing-target">
        <div><p>VPS ROUTING TARGET</p><h3>DNS records expected by Site Manager</h3></div>
        <div>
          {!!payload.routing_target.ipv4?.length && <span>A / IPv4 <code>{payload.routing_target.ipv4.join(', ')}</code></span>}
          {!!payload.routing_target.ipv6?.length && <span>AAAA / IPv6 <code>{payload.routing_target.ipv6.join(', ')}</code></span>}
          {payload.routing_target.cname && <span>CNAME <code>{payload.routing_target.cname}</code></span>}
          {!payload.routing_target.ipv4?.length && !payload.routing_target.ipv6?.length && !payload.routing_target.cname && <span>The VPS public routing target will be filled when production infrastructure is assigned.</span>}
        </div>
      </section>}

      {focus !== 'deployments' && readiness && <ReadinessPanel readiness={readiness} orderedChecks={orderedChecks} />}

      {readiness && !readiness.checks.preview_approved && <section className="domains-approval">
        <div><p>PREVIEW APPROVAL</p><h3>Approve the real nnn preview when the design is correct.</h3><span>This approval is a technical deployment checkpoint. It does not start billing.</span></div>
        <button className="v2-primary-button" type="button" disabled={busy === 'approve'} onClick={() => void act('approve', `/api/v2/domains/${selected.id}/approve-preview`, { method: 'POST', body: '{}' })}>Approve preview</button>
      </section>}
    </>}
  </div>;
}

function State({ label: stateLabel, value, good }: { label: string; value: string; good: boolean }) {
  return <div><span>{stateLabel}</span><strong className={good ? 'good' : ''}>{label(value)}</strong></div>;
}

function ReadinessPanel({ readiness, orderedChecks }: { readiness: Readiness; orderedChecks: readonly (readonly [string, string])[] }) {
  return <section className={`readiness-panel ${readiness.deployment_ready ? 'ready' : ''}`}>
    <div className="readiness-head">
      <div><p>TECHNICAL GATE</p><h3>{readiness.deployment_ready ? 'Ready for VPS deployment' : 'Deployment preparation in progress'}</h3></div>
      <span>{readiness.deployment_ready ? 'READY' : 'NOT READY'}</span>
    </div>
    <div className="readiness-checks">{orderedChecks.map(([key, text]) => <div key={key} className={readiness.checks[key] ? 'done' : ''}><span>{readiness.checks[key] ? '✓' : '○'}</span><strong>{text}</strong></div>)}</div>
    <div className="readiness-meta">
      <span>Primary hostname <strong>{readiness.primary_domain?.hostname || 'Not selected'}</strong></span>
      <span>Deriv callback <strong>{readiness.callback_url || 'Waiting for hostname'}</strong></span>
      <span>Billing <strong>Deferred — not a deployment requirement</strong></span>
    </div>
  </section>;
}
