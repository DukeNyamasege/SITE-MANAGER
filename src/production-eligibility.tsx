import { useCallback, useEffect, useMemo, useState } from 'react';
import './production-eligibility.css';

type EligibilityEvaluation = {
  current: boolean;
  expired?: boolean;
  approved?: boolean;
  blockers?: string[];
  staging_age_minutes?: number | null;
  production_execution_available: boolean;
};

type EligibilityRecord = {
  id: string;
  website_id: string;
  status: string;
  site_key?: string;
  website_name?: string;
  primary_hostname: string;
  held_runtime_commit: string;
  evidence_fingerprint: string;
  staging_edge_run_id: string;
  eligible_at: string;
  expires_at: string;
  approved_at?: string | null;
  current_evaluation?: EligibilityEvaluation | null;
  production_traffic_changed: boolean;
  production_cutover_performed: boolean;
};

type EligibilityResponse = {
  production_eligibility_contract_version: number;
  eligibility_ttl_minutes: number;
  staging_max_age_minutes: number;
  production_execution_available: boolean;
  records: EligibilityRecord[];
};

type StagingRun = {
  id: string;
  website_id: string;
  status: string;
  website_name?: string;
  site_key?: string;
  held_runtime_commit?: string;
};

type StagingResponse = { recent: StagingRun[] };

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(payload?.message || 'Production eligibility request failed.')) as Error & { payload?: unknown };
    error.payload = payload;
    throw error;
  }
  return payload;
}

const shortSha = (value?: string | null) => value ? value.slice(0, 12) : '—';
const titleCase = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

export function ProductionEligibilityWorkspace() {
  const [data, setData] = useState<EligibilityResponse | null>(null);
  const [passedStaging, setPassedStaging] = useState<StagingRun[]>([]);
  const [selectedWebsiteId, setSelectedWebsiteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setError('');
    const [eligibility, staging] = await Promise.all([
      request('/api/v2/admin/production-eligibility') as Promise<EligibilityResponse>,
      request('/api/v2/admin/staging-edge') as Promise<StagingResponse>,
    ]);
    const passed = (staging.recent || []).filter(run => run.status === 'passed');
    const unique = [...new Map(passed.map(run => [run.website_id, run])).values()];
    setData(eligibility);
    setPassedStaging(unique);
    setSelectedWebsiteId(current => current && unique.some(item => item.website_id === current) ? current : (unique[0]?.website_id || ''));
  }, []);

  useEffect(() => { load().catch(err => setError(err instanceof Error ? err.message : String(err))); }, [load]);

  const selected = useMemo(
    () => passedStaging.find(item => item.website_id === selectedWebsiteId) || null,
    [passedStaging, selectedWebsiteId],
  );

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

  const evaluate = () => selected && run(
    () => request(`/api/v2/admin/production-eligibility/website/${encodeURIComponent(selected.website_id)}/evaluate`, { method: 'POST', body: '{}' }),
    'Current parity, canary, staging, runtime and rollback evidence passed the Step 15 production-eligibility gate.',
  );

  const approve = (record: EligibilityRecord) => run(
    () => request(`/api/v2/admin/production-eligibility/${encodeURIComponent(record.id)}/approve`, { method: 'POST', body: '{}' }),
    'Final production eligibility approval recorded. Production traffic remains unchanged.',
  );

  const revoke = (record: EligibilityRecord) => run(
    () => request(`/api/v2/admin/production-eligibility/${encodeURIComponent(record.id)}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Administrator revoked Step 15 eligibility before production execution was enabled.' }),
    }),
    'Production eligibility revoked. No production route was changed.',
  );

  return <div className="production-eligibility-page">
    <section className="v2-hero-card eligibility-hero">
      <div>
        <p className="v2-kicker">STEP 15 · PRODUCTION ELIGIBILITY</p>
        <h2>Freeze one final evidence chain before production execution is even allowed to exist.</h2>
        <p>Eligibility requires the exact migrated site, current Step 11 parity, armed Step 12 plan, passed Step 13 canary, fresh passed Step 14 real HTTPS staging rehearsal, the same held nnn SHA, current V2 fingerprint and preserved rollback evidence. Approval records authorization only—traffic movement is still disabled.</p>
      </div>
      <button className="v2-primary-button" type="button" disabled={busy} onClick={() => void load()}>Refresh evidence</button>
    </section>

    {error && <div className="eligibility-alert error">{error}</div>}
    {message && <div className="eligibility-alert success">{message}</div>}

    {!data ? <section className="v2-card">Loading production eligibility…</section> : <>
      <section className="v2-grid">
        <article className="v2-card"><span className="v2-card-label">CONTRACT</span><h3>v{data.production_eligibility_contract_version}</h3><p>Manager and held nnn must expose the same Step 15 evidence handshake.</p></article>
        <article className="v2-card"><span className="v2-card-label">ELIGIBILITY TTL</span><h3>{data.eligibility_ttl_minutes} min</h3><p>Expired approval evidence must be recreated rather than reused.</p></article>
        <article className="v2-card"><span className="v2-card-label">STAGING FRESHNESS</span><h3>{data.staging_max_age_minutes} min</h3><p>An older Step 14 pass must be rehearsed again before final approval.</p></article>
        <article className="v2-card"><span className="v2-card-label">PRODUCTION EXECUTION</span><h3>Disabled</h3><p>Available: {data.production_execution_available ? 'yes' : 'no'}. Step 15 cannot move traffic.</p></article>
      </section>

      <section className="v2-card eligibility-create">
        <div><span className="v2-card-label">EVALUATE WEBSITE</span><h3>Create immutable Step 15 evidence</h3><p>Only websites with a passed real Step 14 staging rehearsal appear here. The server independently rechecks every prerequisite before creating an eligible record.</p></div>
        <label>Passed staging website
          <select value={selectedWebsiteId} onChange={event => setSelectedWebsiteId(event.target.value)}>
            {!passedStaging.length && <option value="">No passed staging rehearsals available</option>}
            {passedStaging.map(item => <option key={item.website_id} value={item.website_id}>{item.website_name || item.site_key || item.website_id} · nnn {shortSha(item.held_runtime_commit)}</option>)}
          </select>
        </label>
        <button className="v2-primary-button" type="button" disabled={busy || !selected} onClick={() => void evaluate()}>Evaluate production eligibility</button>
      </section>

      <section className="v2-card eligibility-history">
        <span className="v2-card-label">ELIGIBILITY RECORDS</span>
        <h3>Final approval audit trail</h3>
        {!data.records.length ? <p>No production eligibility records yet.</p> : <div className="eligibility-table">{data.records.map(record => {
          const current = record.current_evaluation?.current === true;
          const approved = record.status === 'approved' && record.current_evaluation?.approved === true;
          return <div className="eligibility-row" key={record.id}>
            <div><strong>{record.website_name || record.site_key || record.website_id}</strong><small>{record.primary_hostname}</small></div>
            <div><span className={`eligibility-state ${current ? 'good' : 'blocked'}`}>{titleCase(record.status)}</span><small>{current ? 'Evidence current' : 'Evidence stale / inactive'}</small></div>
            <div><strong>nnn {shortSha(record.held_runtime_commit)}</strong><small>evidence {shortSha(record.evidence_fingerprint)}</small></div>
            <div><strong>{record.current_evaluation?.staging_age_minutes == null ? '—' : `${Math.round(record.current_evaluation.staging_age_minutes)} min`}</strong><small>staging evidence age</small></div>
            <div className="eligibility-row-actions">
              {record.status === 'eligible' && current && <button className="v2-primary-button" type="button" disabled={busy} onClick={() => void approve(record)}>Final approve</button>}
              {approved && <span className="eligibility-approved">APPROVED · EXECUTION STILL LOCKED</span>}
              {['eligible', 'approved'].includes(record.status) && <button type="button" disabled={busy} onClick={() => void revoke(record)}>Revoke</button>}
            </div>
          </div>;
        })}</div>}
      </section>
    </>}
  </div>;
}
