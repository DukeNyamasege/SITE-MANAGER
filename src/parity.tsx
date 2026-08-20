import { useCallback, useEffect, useMemo, useState } from 'react';
import './parity.css';

type ParityListWebsite = {
  id: string;
  name: string;
  site_key: string;
  source: string;
  status: string;
  primary_domain: string | null;
  domain_status: string;
  deployment_status: string;
  preview_approved_at: string | null;
  drift_status: string;
  source_commit: string;
  source_fingerprint: string;
  parity_status: string;
  cutover_ready: boolean;
  stored_parity_status: string;
  checked_at: string | null;
};

type CheckMap = Record<string, boolean>;

type ParityDetail = {
  website: {
    id: string;
    name: string;
    site_key: string;
    source: string;
    status: string;
    primary_domain: string | null;
    domain_status: string;
    deployment_status: string;
    preview_approved_at: string | null;
  };
  parity: {
    report_version: number;
    status: 'blocked' | 'parity_ready' | 'stale';
    cutover_ready: boolean;
    checks: CheckMap;
    blockers: Array<{ key: string; message: string }>;
    source: {
      repository: string;
      commit: string;
      fingerprint: string;
      assigned_fingerprint: string;
      drift_status: string;
    };
    runtime: {
      held_commit: string;
      evidence_current: boolean;
      evidence: {
        registry_entry_match?: boolean;
        customization_assets_match?: boolean;
        free_bot_manifest_match?: boolean;
        free_bot_assets_match?: boolean;
        runtime_contract_compatible?: boolean;
        bot_asset_checks?: Array<{ id: string; asset: string; match: boolean }>;
      };
    };
    v2_fingerprint: string;
    production_cutover_performed: boolean;
  };
  evidence_checked_at: string | null;
  note: string;
};

const CHECK_LABELS: Record<string, string> = {
  migrated_site_linked: 'Migration link',
  legacy_site_id_preserved: 'Legacy site ID',
  source_not_drifted: 'Live source drift',
  primary_domain_matches: 'Primary domain',
  domain_aliases_match: 'Domain aliases',
  domain_ownership_verified: 'Domain ownership',
  deriv_client_matches: 'Deriv Client/App ID',
  deriv_scopes_match: 'Deriv scopes',
  deriv_environment_matches: 'Deriv environment',
  redirect_uri_matches: 'Deriv callback URL',
  navigation_matches: 'Navigation/features',
  colors_match: 'Theme colors',
  branding_matches_legacy_identity: 'Brand identity',
  configuration_complete: 'V2 configuration',
  preview_approved: 'Preview approval',
  runtime_evidence_current: 'Runtime evidence freshness',
  runtime_registry_match: 'Held registry entry',
  runtime_customization_assets_match: 'Held customization assets',
  runtime_bot_manifest_match: 'Held bot manifest',
  runtime_bot_assets_match: 'Held bot assets',
  runtime_contract_compatible: 'Held runtime contract',
  production_still_on_legacy: 'Production still legacy',
};

async function api(path = '') {
  const response = await fetch(`/api/v2/parity${path}`, { credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.message || 'Parity request failed.'));
  return payload;
}

function shortSha(value?: string | null) {
  return value ? value.slice(0, 12) : 'Not checked';
}

function statusText(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

export function CutoverReadinessWorkspace() {
  const [websites, setWebsites] = useState<ParityListWebsite[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<ParityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadList = useCallback(async () => {
    const result = await api();
    const sites = (result.websites || []) as ParityListWebsite[];
    setWebsites(sites);
    setSelectedId(current => current && sites.some(site => site.id === current) ? current : (sites[0]?.id || ''));
  }, []);

  const loadDetail = useCallback(async (websiteId: string) => {
    if (!websiteId) { setDetail(null); return; }
    setBusy(true); setError('');
    try { setDetail(await api(`/${encodeURIComponent(websiteId)}`) as ParityDetail); }
    catch (err) { setDetail(null); setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadList().catch(err => { if (active) setError(err instanceof Error ? err.message : String(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadList]);

  useEffect(() => { if (selectedId) void loadDetail(selectedId); else setDetail(null); }, [selectedId, loadDetail]);

  const counts = useMemo(() => ({
    migrated: websites.length,
    ready: websites.filter(site => site.parity_status === 'parity_ready').length,
    stale: websites.filter(site => site.parity_status === 'stale' || site.drift_status === 'drifted').length,
  }), [websites]);

  if (loading) return <section className="parity-loading">Loading dual-run readiness…</section>;

  return <div className="parity-page">
    <section className="v2-hero-card parity-hero">
      <div>
        <p className="v2-kicker">STEP 11 · DUAL-RUN PARITY</p>
        <h2>Prove the V2 shadow matches the still-live nnn site before any cutover.</h2>
        <p>Every required check is fail-closed. A green report is evidence only: it does not change DNS, route traffic, deploy the website, modify production nnn/main or start billing.</p>
      </div>
      <button className="v2-primary-button" type="button" disabled={busy} onClick={() => { void loadList(); if (selectedId) void loadDetail(selectedId); }}>Refresh evidence</button>
    </section>

    {error && <div className="parity-alert error">{error}</div>}

    <section className="v2-grid">
      <article className="v2-card"><span className="v2-card-label">MIGRATED</span><h3>{counts.migrated}</h3><p>Customer-owned V2 shadows linked to the controlled legacy inventory.</p></article>
      <article className="v2-card"><span className="v2-card-label">PARITY READY</span><h3>{counts.ready}</h3><p>Current database state still passes the latest exact runtime evidence.</p></article>
      <article className="v2-card"><span className="v2-card-label">STALE / DRIFTED</span><h3>{counts.stale}</h3><p>Live source or held-runtime evidence changed and must be audited again.</p></article>
    </section>

    {!websites.length ? <section className="v2-card"><h3>No migrated websites yet</h3><p>Step 11 only applies after an administrator assigns an audited existing nnn site to this account.</p></section> : <>
      <section className="parity-selector v2-card">
        <label>Migrated website
          <select value={selectedId} onChange={event => setSelectedId(event.target.value)}>
            {websites.map(site => <option key={site.id} value={site.id}>{site.name} · {site.site_key}</option>)}
          </select>
        </label>
        <div><span>Current readiness</span><strong>{statusText(websites.find(site => site.id === selectedId)?.parity_status || 'not_checked')}</strong></div>
      </section>

      {detail && <>
        <section className={`parity-status-card ${detail.parity.cutover_ready ? 'ready' : detail.parity.status === 'stale' ? 'stale' : 'blocked'}`}>
          <div><p>CUTOVER READINESS</p><h2>{detail.parity.cutover_ready ? 'PARITY READY' : detail.parity.status === 'stale' ? 'EVIDENCE STALE' : 'CUTOVER BLOCKED'}</h2><span>{detail.website.primary_domain || detail.website.site_key}</span></div>
          <div className="parity-status-meta"><span>Live source {shortSha(detail.parity.source.commit)}</span><span>Held runtime {shortSha(detail.parity.runtime.held_commit)}</span><span>Evidence generated {detail.evidence_checked_at ? new Date(detail.evidence_checked_at).toLocaleString() : 'not yet'}</span></div>
        </section>

        {detail.parity.blockers.length > 0 && <section className="parity-blockers v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">BLOCKERS</span><h3>{detail.parity.blockers.length} checks require attention</h3></div><span className="v2-state">FAIL CLOSED</span></div>
          <ul>{detail.parity.blockers.map(blocker => <li key={blocker.key}><strong>{CHECK_LABELS[blocker.key] || statusText(blocker.key)}</strong><span>{blocker.message}</span></li>)}</ul>
        </section>}

        <section className="v2-section">
          <div className="v2-section-heading"><div><p>PARITY MATRIX</p><h2>Live nnn ↔ V2 shadow ↔ held runtime</h2></div></div>
          <div className="parity-check-grid">
            {Object.entries(detail.parity.checks).map(([key, passed]) => <article className={`parity-check ${passed ? 'pass' : 'fail'}`} key={key}><span>{passed ? '✓' : '×'}</span><div><strong>{CHECK_LABELS[key] || statusText(key)}</strong><small>{passed ? 'Matched' : 'Blocked'}</small></div></article>)}
          </div>
        </section>

        <section className="v2-grid">
          <article className="v2-card"><span className="v2-card-label">SOURCE FINGERPRINT</span><h3>{shortSha(detail.parity.source.fingerprint)}</h3><p>Drift: {statusText(detail.parity.source.drift_status)} · assignment fingerprint {shortSha(detail.parity.source.assigned_fingerprint)}</p></article>
          <article className="v2-card"><span className="v2-card-label">V2 FINGERPRINT</span><h3>{shortSha(detail.parity.v2_fingerprint)}</h3><p>Changes in customer configuration immediately change this fingerprint and can invalidate readiness.</p></article>
          <article className="v2-card"><span className="v2-card-label">CUTOVER</span><h3>Not performed</h3><p>Step 11 cannot set production cutover true. That state is database-constrained to false.</p></article>
        </section>

        {(detail.parity.runtime.evidence.bot_asset_checks || []).length > 0 && <section className="v2-card parity-assets"><div className="v2-card-head"><div><span className="v2-card-label">BOT ASSET PARITY</span><h3>Referenced legacy bot files</h3></div></div><div>{detail.parity.runtime.evidence.bot_asset_checks!.map(asset => <span key={`${asset.id}:${asset.asset}`} className={asset.match ? 'pass' : 'fail'}>{asset.match ? '✓' : '×'} {asset.id || asset.asset}</span>)}</div></section>}
      </>}
    </>}
  </div>;
}
