import { useCallback, useEffect, useMemo, useState } from 'react';
import './cutover.css';

type PlanEvaluation = {
  current: boolean;
  expired: boolean;
  comparisons: Record<string, boolean>;
  blockers: string[];
  execution_enabled: boolean;
  production_cutover_performed: boolean;
};

type CutoverPlan = {
  id: string;
  website_id: string;
  status: 'prepared' | 'armed' | 'invalidated' | 'cancelled' | 'expired';
  primary_hostname: string;
  legacy_source_commit: string;
  legacy_source_fingerprint: string;
  held_runtime_commit: string;
  v2_fingerprint: string;
  plan_fingerprint: string;
  rollback_window_minutes: number;
  expires_at: string;
  armed_at: string | null;
  invalidated_at: string | null;
  invalidation_reason: string | null;
  cancelled_at: string | null;
  production_cutover_performed: boolean;
  created_at: string;
  parity_snapshot: Record<string, unknown>;
  runtime_snapshot: {
    cutover_contract_version?: number;
    cutover_contract_compatible?: boolean;
    planned_health_url?: string;
  };
  rollback_snapshot: {
    legacy_website_url?: string;
    source_commit?: string;
    primary_hostname?: string;
    hosts?: string[];
    rollback_window_minutes?: number;
    dns_or_provider_rollback_requires_execution_step?: boolean;
  };
  preflight_snapshot: {
    routing_target_configured?: boolean;
    routing_target?: { ipv4?: string[]; ipv6?: string[]; cname?: string };
    expected_callback_url?: string;
    execution_enabled?: boolean;
  };
  current_evaluation?: PlanEvaluation | null;
};

type CutoverSite = {
  website: {
    id: string;
    name: string;
    site_key: string;
    primary_domain: string | null;
    deployment_status: string;
  };
  parity: {
    status: string;
    cutover_ready: boolean;
    blockers: Array<{ key: string; message: string }>;
  } | null;
  open_plan: CutoverPlan | null;
};

type CutoverListResponse = {
  cutover_contract_version: number;
  execution_enabled: boolean;
  sites: CutoverSite[];
  message?: string;
};

async function api(path = '', options: RequestInit = {}) {
  const response = await fetch(`/api/v2/admin/cutover${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(payload?.message || 'Cutover request failed.')) as Error & { status?: number; payload?: unknown };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

const shortSha = (value?: string | null) => value ? value.slice(0, 12) : '—';
const titleCase = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

function routingText(plan: CutoverPlan) {
  const target = plan.preflight_snapshot.routing_target;
  if (!plan.preflight_snapshot.routing_target_configured) return 'Not configured';
  if (target?.cname) return target.cname;
  return [...(target?.ipv4 || []), ...(target?.ipv6 || [])].join(', ') || 'Configured';
}

export function CutoverOrchestrationWorkspace() {
  const [data, setData] = useState<CutoverListResponse | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [rollbackWindow, setRollbackWindow] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setError('');
    const result = await api() as CutoverListResponse;
    setData(result);
    setSelectedId(current => current && result.sites.some(site => site.website.id === current)
      ? current
      : (result.sites[0]?.website.id || ''));
  }, []);

  useEffect(() => { load().catch(err => setError(err instanceof Error ? err.message : String(err))); }, [load]);

  const selected = useMemo(() => data?.sites.find(site => site.website.id === selectedId) || null, [data, selectedId]);
  const plan = selected?.open_plan || null;

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

  const prepare = () => selected && run(
    () => api(`/${encodeURIComponent(selected.website.id)}/prepare`, {
      method: 'POST', body: JSON.stringify({ rollback_window_minutes: rollbackWindow }),
    }),
    'Immutable cutover plan prepared from the current parity evidence.',
  );

  const arm = () => plan && run(
    () => api(`/plans/${encodeURIComponent(plan.id)}/arm`, { method: 'POST', body: '{}' }),
    'Cutover plan armed. Production execution is still disabled.',
  );

  const cancel = () => plan && run(
    () => api(`/plans/${encodeURIComponent(plan.id)}/cancel`, { method: 'POST', body: '{}' }),
    'Cutover plan cancelled without changing production traffic.',
  );

  return <div className="cutover-page">
    <section className="v2-hero-card cutover-hero">
      <div>
        <p className="v2-kicker">STEP 12 · CONTROLLED CUTOVER ORCHESTRATION</p>
        <h2>Freeze exact readiness evidence before any production traffic can move.</h2>
        <p>Only a Site Manager administrator can prepare or arm these plans. Every plan pins the legacy source, held nnn release, V2 fingerprint, domain, Deriv callback and rollback target. Arming never executes cutover in Step 12.</p>
      </div>
      <button className="v2-primary-button" type="button" disabled={busy} onClick={() => void load()}>Refresh evidence</button>
    </section>

    {error && <div className="cutover-alert error">{error}</div>}
    {message && <div className="cutover-alert success">{message}</div>}

    {!data ? <section className="cutover-loading">Loading operator cutover workspace…</section> : <>
      <section className="v2-grid">
        <article className="v2-card"><span className="v2-card-label">CONTRACT</span><h3>v{data.cutover_contract_version}</h3><p>Shared nnn cutover handshake required before a plan can be created.</p></article>
        <article className="v2-card"><span className="v2-card-label">PARITY READY</span><h3>{data.sites.filter(site => site.parity?.cutover_ready).length}</h3><p>Migrated sites currently eligible to prepare a plan.</p></article>
        <article className="v2-card"><span className="v2-card-label">EXECUTION</span><h3>Disabled</h3><p>Step 12 can prepare and arm only. Traffic switching remains unavailable.</p></article>
      </section>

      {!data.sites.length ? <section className="v2-card"><h3>No migrated sites available</h3><p>Assign and pass Step 11 parity before using cutover orchestration.</p></section> : <>
        <section className="cutover-selector v2-card">
          <label>Migrated website
            <select value={selectedId} onChange={event => setSelectedId(event.target.value)}>
              {data.sites.map(site => <option key={site.website.id} value={site.website.id}>{site.website.name} · {site.website.site_key}</option>)}
            </select>
          </label>
          <div><span>Parity</span><strong className={selected?.parity?.cutover_ready ? 'good' : ''}>{selected?.parity ? titleCase(selected.parity.status) : 'Unavailable'}</strong></div>
          <div><span>Production</span><strong>{selected?.website.deployment_status || '—'}</strong></div>
        </section>

        {selected && !plan && <section className="v2-card cutover-prepare">
          <div><span className="v2-card-label">PREPARE</span><h3>Create immutable cutover evidence</h3><p>The plan captures the current Step 11 evidence. If configuration, source fingerprints or held runtime change afterward, that plan becomes invalid instead of silently updating.</p></div>
          <label>Rollback window after a future execution
            <select value={rollbackWindow} onChange={event => setRollbackWindow(Number(event.target.value))}>
              <option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option><option value={120}>120 minutes</option>
            </select>
          </label>
          <button className="v2-primary-button" type="button" disabled={busy || !selected.parity?.cutover_ready} onClick={() => void prepare()}>Prepare cutover plan</button>
        </section>}

        {plan && <>
          <section className={`cutover-plan ${plan.status}`}>
            <div><p>CUTOVER PLAN</p><h2>{titleCase(plan.status)}</h2><span>{plan.primary_hostname}</span></div>
            <div className="cutover-plan-meta"><span>Plan {shortSha(plan.plan_fingerprint)}</span><span>Expires {new Date(plan.expires_at).toLocaleString()}</span><span>Rollback {plan.rollback_window_minutes} min</span></div>
          </section>

          {plan.current_evaluation && !plan.current_evaluation.current && <section className="v2-card cutover-blockers"><span className="v2-card-label">CURRENT BLOCKERS</span><h3>Plan cannot be armed</h3><ul>{plan.current_evaluation.blockers.map(item => <li key={item}>{titleCase(item)}</li>)}</ul></section>}

          <section className="cutover-evidence-grid">
            <article className="v2-card"><span className="v2-card-label">LEGACY SOURCE</span><h3>{shortSha(plan.legacy_source_commit)}</h3><p>Fingerprint {shortSha(plan.legacy_source_fingerprint)}</p></article>
            <article className="v2-card"><span className="v2-card-label">HELD NNN</span><h3>{shortSha(plan.held_runtime_commit)}</h3><p>Cutover contract v{plan.runtime_snapshot.cutover_contract_version || 0}</p></article>
            <article className="v2-card"><span className="v2-card-label">V2 STATE</span><h3>{shortSha(plan.v2_fingerprint)}</h3><p>Any customer edit changes this evidence.</p></article>
            <article className="v2-card"><span className="v2-card-label">ROUTING TARGET</span><h3>{plan.preflight_snapshot.routing_target_configured ? 'Configured' : 'Missing'}</h3><p>{routingText(plan)}</p></article>
            <article className="v2-card"><span className="v2-card-label">HEALTH CHECK</span><h3>Post-cutover</h3><p>{plan.runtime_snapshot.planned_health_url || 'Not available'}</p></article>
            <article className="v2-card"><span className="v2-card-label">ROLLBACK TARGET</span><h3>{plan.rollback_snapshot.primary_hostname || 'Legacy nnn'}</h3><p>{plan.rollback_snapshot.legacy_website_url || 'Existing production runtime'} · exact source {shortSha(plan.rollback_snapshot.source_commit)}</p></article>
          </section>

          <section className="v2-card cutover-actions">
            <div><span className="v2-card-label">OPERATOR ACTIONS</span><h3>Arming is not execution</h3><p>The execution boundary is intentionally unavailable. A future step must introduce a separate production execution contract and rollback drill.</p></div>
            <div>
              {plan.status === 'prepared' && <button className="v2-primary-button" type="button" disabled={busy || !plan.current_evaluation?.current} onClick={() => void arm()}>Arm plan</button>}
              {['prepared', 'armed'].includes(plan.status) && <button type="button" disabled={busy} onClick={() => void cancel()}>Cancel plan</button>}
              <button type="button" disabled>Execute cutover · Step 13</button>
            </div>
          </section>
        </>}
      </>}
    </>}
  </div>;
}
