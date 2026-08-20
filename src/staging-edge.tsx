import { useCallback, useEffect, useMemo, useState } from 'react';
import './staging-edge.css';

type CanaryExecution = {
  id: string;
  plan_id: string;
  website_id: string;
  status: string;
  website_name?: string;
  site_key?: string;
  primary_hostname?: string;
  held_runtime_commit?: string;
};

type StagingRun = {
  id: string;
  canary_execution_id: string;
  plan_id: string;
  website_id: string;
  status: string;
  staging_hostname: string;
  held_runtime_commit: string;
  health_url?: string | null;
  rollback_deadline?: string | null;
  last_healthy_at?: string | null;
  recovered_at?: string | null;
  automatic_rollback: boolean;
  staging_traffic_changed: boolean;
  production_traffic_changed: boolean;
  failure_message?: string | null;
  website_name?: string;
  site_key?: string;
  events?: Array<{ event_type: string; created_at: string }>;
};

type StagingResponse = {
  staging_edge_contract_version: number;
  mode: string;
  environment: string;
  approved: boolean;
  staging_hostname: string;
  production_execution_available: boolean;
  active: StagingRun | null;
  recent: StagingRun[];
};

type CanaryResponse = { recent: CanaryExecution[] };

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.message || 'Staging-edge request failed.'));
  return payload;
}

const shortSha = (value?: string | null) => value ? value.slice(0, 12) : '—';
const titleCase = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

export function StagingEdgeWorkspace() {
  const [data, setData] = useState<StagingResponse | null>(null);
  const [canaries, setCanaries] = useState<CanaryExecution[]>([]);
  const [selectedCanary, setSelectedCanary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setError('');
    const [edge, canary] = await Promise.all([
      request('/api/v2/admin/staging-edge') as Promise<StagingResponse>,
      request('/api/v2/admin/canary') as Promise<CanaryResponse>,
    ]);
    const passed = (canary.recent || []).filter(item => item.status === 'passed');
    setData(edge);
    setCanaries(passed);
    setSelectedCanary(current => current && passed.some(item => item.id === current) ? current : (passed[0]?.id || ''));
  }, []);

  useEffect(() => { load().catch(err => setError(err instanceof Error ? err.message : String(err))); }, [load]);

  const selected = useMemo(() => canaries.find(item => item.id === selectedCanary) || null, [canaries, selectedCanary]);

  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await work();
      setMessage(success);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  };

  const start = () => selected && run(
    () => request(`/api/v2/admin/staging-edge/canary/${encodeURIComponent(selected.id)}/start`, { method: 'POST', body: '{}' }),
    'Real staging route activated and initial HTTPS health verification passed.',
  );
  const rollback = () => data?.active && run(
    () => request(`/api/v2/admin/staging-edge/runs/${encodeURIComponent(data.active!.id)}/rollback`, { method: 'POST', body: '{}' }),
    'Staging route rolled back. Production traffic was unchanged.',
  );
  const pass = () => data?.active && run(
    () => request(`/api/v2/admin/staging-edge/runs/${encodeURIComponent(data.active!.id)}/pass`, { method: 'POST', body: '{}' }),
    'Staging-edge rehearsal passed and the temporary staging route was retired.',
  );
  const failureDrill = () => data?.active && run(
    () => request(`/api/v2/admin/staging-edge/runs/${encodeURIComponent(data.active!.id)}/failure-drill`, { method: 'POST', body: '{}' }),
    'Failure drill completed. The health monitor restored the staging edge automatically.',
  );

  return <div className="staging-edge-page">
    <section className="v2-hero-card staging-edge-hero">
      <div>
        <p className="v2-kicker">STEP 14 · REAL STAGING EDGE</p>
        <h2>Exercise the held nnn build through a real HTTPS reverse proxy without touching a customer hostname.</h2>
        <p>The staging adapter uses its own Caddy admin endpoint and Caddyfile. A passed Step 13 canary is required, health is checked through HTTPS, and the monitor survives Site Manager restarts. Production traffic remains locked.</p>
      </div>
      <button className="v2-primary-button" type="button" disabled={busy} onClick={() => void load()}>Refresh staging state</button>
    </section>

    {error && <div className="staging-edge-alert error">{error}</div>}
    {message && <div className="staging-edge-alert success">{message}</div>}

    {!data ? <section className="v2-card">Loading staging-edge state…</section> : <>
      <section className="v2-grid">
        <article className="v2-card"><span className="v2-card-label">CONTRACT</span><h3>v{data.staging_edge_contract_version}</h3><p>Held nnn staging-edge handshake.</p></article>
        <article className="v2-card"><span className="v2-card-label">HOST ROLE</span><h3>{titleCase(data.environment)}</h3><p>{data.mode === 'staging' && data.approved ? 'Explicitly approved staging host.' : 'Fail-closed until staging approval is installed.'}</p></article>
        <article className="v2-card"><span className="v2-card-label">STAGING HOST</span><h3>{data.staging_hostname || 'Not configured'}</h3><p>Must never equal a customer production hostname.</p></article>
        <article className="v2-card"><span className="v2-card-label">PRODUCTION</span><h3>Locked</h3><p>Production execution available: {data.production_execution_available ? 'yes' : 'no'}.</p></article>
      </section>

      {data.active ? <>
        <section className={`staging-edge-active ${data.active.status}`}>
          <div><p>ACTIVE STAGING RUN</p><h2>{titleCase(data.active.status)}</h2><span>{data.active.staging_hostname}</span></div>
          <div><span>nnn {shortSha(data.active.held_runtime_commit)}</span><span>Last healthy {data.active.last_healthy_at ? new Date(data.active.last_healthy_at).toLocaleString() : 'pending'}</span><span>Rollback deadline {data.active.rollback_deadline ? new Date(data.active.rollback_deadline).toLocaleString() : 'pending'}</span></div>
        </section>
        <section className="v2-card staging-edge-actions">
          <div><span className="v2-card-label">OPERATOR CONTROLS</span><h3>Monitor, prove rollback, or retire the staging route</h3><p>These actions affect only the dedicated staging edge. They do not update customer DNS, production Caddy routes, website deployment state or billing.</p></div>
          <div>
            <button type="button" disabled={busy} onClick={() => void rollback()}>Rollback staging</button>
            <button type="button" disabled={busy} onClick={() => void failureDrill()}>Run failure drill</button>
            <button className="v2-primary-button" type="button" disabled={busy} onClick={() => void pass()}>Mark staging passed</button>
          </div>
        </section>
      </> : <section className="v2-card staging-edge-start">
        <div><span className="v2-card-label">START REAL STAGING REHEARSAL</span><h3>Select a PASSED Step 13 canary</h3><p>The server revalidates the immutable armed plan, current parity, exact held nnn SHA and Step 14 contract before writing or reloading the staging Caddyfile.</p></div>
        <label>Passed canary
          <select value={selectedCanary} onChange={event => setSelectedCanary(event.target.value)}>
            {!canaries.length && <option value="">No passed canaries available</option>}
            {canaries.map(item => <option key={item.id} value={item.id}>{item.website_name || item.site_key || item.id} · {shortSha(item.held_runtime_commit)}</option>)}
          </select>
        </label>
        <button className="v2-primary-button" type="button" disabled={busy || !selected || data.mode !== 'staging' || !data.approved} onClick={() => void start()}>Start staging edge</button>
      </section>}

      <section className="v2-card staging-edge-history">
        <span className="v2-card-label">RECENT REHEARSALS</span>
        <h3>Staging-edge audit history</h3>
        {!data.recent.length ? <p>No staging-edge runs yet.</p> : <div className="staging-edge-table">{data.recent.map(runItem => <div key={runItem.id}><strong>{runItem.website_name || runItem.site_key || runItem.website_id}</strong><span>{titleCase(runItem.status)}</span><span>{runItem.staging_hostname}</span><span>{runItem.automatic_rollback ? 'Automatic rollback' : 'No automatic rollback'}</span><span>production: unchanged</span></div>)}</div>}
      </section>
    </>}
  </div>;
}
