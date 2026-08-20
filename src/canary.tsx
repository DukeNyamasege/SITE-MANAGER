import { useCallback, useEffect, useMemo, useState } from 'react';
import './canary.css';

type CanaryExecution = {
  id: string;
  plan_id: string;
  website_id: string;
  mode: 'simulate';
  status: 'activating' | 'monitoring' | 'passed' | 'rolled_back' | 'failed';
  primary_hostname: string;
  held_runtime_commit: string;
  rollback_deadline: string | null;
  automatic_rollback: boolean;
  production_traffic_changed: false;
  production_cutover_performed: false;
  health_snapshot: { ok?: boolean; attempts?: Array<{ attempt: number; passed: boolean; checks: Record<string, boolean> }> };
  failure_message?: string | null;
  website_name?: string;
  site_key?: string;
};

type CutoverSite = {
  website: { id: string; name: string; site_key: string; primary_domain: string | null };
  parity: { cutover_ready: boolean; status: string } | null;
  open_plan: { id: string; status: string; primary_hostname: string; current_evaluation?: { current: boolean } | null } | null;
};

type CanaryState = {
  contract_version: number;
  mode: 'disabled' | 'simulate';
  production_execution_available: false;
  active: CanaryExecution | null;
  recent: CanaryExecution[];
};

async function jsonApi(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.message || 'Canary request failed.'));
  return payload;
}

const shortSha = (value?: string | null) => value ? value.slice(0, 12) : '—';
const titleCase = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

export function CanaryCutoverWorkspace() {
  const [state, setState] = useState<CanaryState | null>(null);
  const [sites, setSites] = useState<CutoverSite[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setError('');
    const [canary, cutover] = await Promise.all([
      jsonApi('/api/v2/admin/canary') as Promise<CanaryState>,
      jsonApi('/api/v2/admin/cutover') as Promise<{ sites: CutoverSite[] }>,
    ]);
    setState(canary);
    setSites(cutover.sites || []);
    setSelectedId(current => current && cutover.sites.some(site => site.website.id === current)
      ? current
      : (cutover.sites.find(site => site.open_plan?.status === 'armed')?.website.id || cutover.sites[0]?.website.id || ''));
  }, []);

  useEffect(() => { load().catch(err => setError(err instanceof Error ? err.message : String(err))); }, [load]);
  const selected = useMemo(() => sites.find(site => site.website.id === selectedId) || null, [sites, selectedId]);
  const armedPlan = selected?.open_plan?.status === 'armed' ? selected.open_plan : null;

  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(''); setMessage('');
    try { await work(); setMessage(success); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  const execute = (simulateFailure: boolean) => armedPlan && run(
    () => jsonApi(`/api/v2/admin/canary/plan/${encodeURIComponent(armedPlan.id)}/execute`, {
      method: 'POST', body: JSON.stringify({ simulate_failure: simulateFailure }),
    }),
    simulateFailure
      ? 'Failure drill completed. The simulated route should be automatically rolled back to the frozen legacy snapshot.'
      : 'Healthy canary simulation is now in its rollback-monitoring window.',
  );

  const rollback = () => state?.active && run(
    () => jsonApi(`/api/v2/admin/canary/executions/${encodeURIComponent(state.active!.id)}/rollback`, { method: 'POST', body: '{}' }),
    'Canary simulation rolled back. Production traffic was not changed.',
  );

  const pass = () => state?.active && run(
    () => jsonApi(`/api/v2/admin/canary/executions/${encodeURIComponent(state.active!.id)}/pass`, { method: 'POST', body: '{}' }),
    'Canary simulation passed. This is evidence only; production still has not moved.',
  );

  return <div className="canary-page">
    <section className="v2-hero-card canary-hero">
      <div><p className="v2-kicker">STEP 13 · CANARY CUTOVER & ROLLBACK DRILL</p><h2>Prove one-site activation and rollback without touching production.</h2><p>The canary controller is simulation-only. It validates an armed immutable plan against the exact held nnn artifact, creates isolated route state, runs health criteria and starts the rollback timer only after health passes.</p></div>
      <button className="v2-primary-button" type="button" disabled={busy} onClick={() => void load()}>Refresh canary state</button>
    </section>

    {error && <div className="canary-alert error">{error}</div>}
    {message && <div className="canary-alert success">{message}</div>}

    {!state ? <section className="v2-card">Loading canary controller…</section> : <>
      <section className="v2-grid">
        <article className="v2-card"><span className="v2-card-label">CANARY CONTRACT</span><h3>v{state.contract_version}</h3><p>Exact held nnn build handshake.</p></article>
        <article className="v2-card"><span className="v2-card-label">MODE</span><h3>{titleCase(state.mode)}</h3><p>Step 13 has no live/apply mode.</p></article>
        <article className="v2-card"><span className="v2-card-label">PRODUCTION TRAFFIC</span><h3>Locked</h3><p>Database contract requires production_traffic_changed = false.</p></article>
      </section>

      <section className="v2-card canary-selector">
        <label>Armed migrated site
          <select value={selectedId} onChange={event => setSelectedId(event.target.value)}>
            {sites.map(site => <option key={site.website.id} value={site.website.id}>{site.website.name} · {site.website.site_key}</option>)}
          </select>
        </label>
        <div><span>Parity</span><strong>{selected?.parity?.cutover_ready ? 'Ready' : 'Blocked'}</strong></div>
        <div><span>Plan</span><strong>{selected?.open_plan ? titleCase(selected.open_plan.status) : 'None'}</strong></div>
      </section>

      {state.active ? <section className="canary-active v2-card">
        <div><span className="v2-card-label">ACTIVE SIMULATION</span><h3>{state.active.primary_hostname}</h3><p>{titleCase(state.active.status)} · nnn {shortSha(state.active.held_runtime_commit)}</p></div>
        <div><span>Rollback deadline</span><strong>{state.active.rollback_deadline ? new Date(state.active.rollback_deadline).toLocaleString() : 'Not started'}</strong></div>
        <div className="canary-actions"><button type="button" disabled={busy} onClick={() => void rollback()}>Rollback simulation</button><button className="v2-primary-button" type="button" disabled={busy} onClick={() => void pass()}>Mark canary passed</button></div>
      </section> : <section className="v2-card canary-actions-card">
        <div><span className="v2-card-label">EXECUTE DRILL</span><h3>{armedPlan ? armedPlan.primary_hostname : 'Arm a fresh Step 12 plan first'}</h3><p>Only one canary can be active platform-wide. Both buttons below operate on isolated simulation state and never call the production publisher.</p></div>
        <div className="canary-actions"><button className="v2-primary-button" type="button" disabled={busy || state.mode !== 'simulate' || !armedPlan || !armedPlan.current_evaluation?.current} onClick={() => void execute(false)}>Run healthy canary</button><button type="button" disabled={busy || state.mode !== 'simulate' || !armedPlan || !armedPlan.current_evaluation?.current} onClick={() => void execute(true)}>Run automatic rollback drill</button></div>
      </section>}

      <section className="v2-section"><div className="v2-section-heading"><div><p>AUDIT</p><h2>Recent canary evidence</h2></div></div><div className="canary-history">{state.recent.length ? state.recent.map(item => <article className="v2-card" key={item.id}><div className="canary-history-head"><strong>{item.website_name || item.primary_hostname}</strong><span>{titleCase(item.status)}</span></div><p>{item.primary_hostname} · {shortSha(item.held_runtime_commit)}</p><p>Health {item.health_snapshot?.ok === true ? 'passed' : item.health_snapshot?.ok === false ? 'failed' : 'pending'} · Automatic rollback {item.automatic_rollback ? 'yes' : 'no'}</p><small>Production traffic changed: no</small></article>) : <div className="v2-card">No canary executions yet.</div>}</div></section>
    </>}
  </div>;
}
