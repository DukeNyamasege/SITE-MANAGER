import { useCallback, useEffect, useState } from 'react';

type LegacySite = {
  id: string;
  legacy_site_id: string;
  display_domain: string;
  hosts: string[];
  source_commit: string;
  source_fingerprint: string;
  customization_source: 'explicit' | 'inherited_defaults';
  free_bot_manifest_path: string | null;
  status: 'unassigned' | 'assigned' | 'ignored' | 'error';
  drift_status: 'not_assigned' | 'current' | 'drifted';
  assigned_owner: { id: string; email: string; display_name: string } | null;
  website_id: string | null;
  assigned_at: string | null;
  last_audited_at: string;
};

type InventoryResponse = {
  summary: { total: number; unassigned: number; assigned: number; drifted: number };
  sites: LegacySite[];
  message?: string;
};

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/v2/admin/${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || 'Migration request failed.');
  return payload;
}

export function LegacyMigrationWorkspace() {
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [error, setError] = useState('');
  const [busySite, setBusySite] = useState('');
  const [ownerEmails, setOwnerEmails] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError('');
    try { setData(await api('legacy-sites')); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const assign = async (site: LegacySite) => {
    const email = String(ownerEmails[site.legacy_site_id] || '').trim();
    if (!email) { setError(`Enter the verified Site Manager owner email for ${site.display_domain}.`); return; }
    setBusySite(site.legacy_site_id); setError('');
    try {
      await api(`legacy-sites/${encodeURIComponent(site.legacy_site_id)}/assign`, {
        method: 'POST', body: JSON.stringify({ owner_email: email }),
      });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusySite(''); }
  };

  return <>
    <section className="v2-hero-card">
      <div>
        <p className="v2-kicker">STEP 10 · LEGACY NNN MIGRATION</p>
        <h2>Existing live nnn sites enter V2 through an audited inventory, never by public domain claiming.</h2>
        <p>Assignment preserves each legacy site key, hostname aliases, Deriv Client ID/scopes, navigation/colors and legacy asset references. The resulting website is a V2 shadow record only; assigning it does not publish to the VPS or change current nnn traffic.</p>
      </div>
      <button className="v2-primary-button" type="button" onClick={() => void load()}>Refresh audit</button>
    </section>

    {error && <section className="v2-card"><div className="auth-alert error">{error}</div><p>If this says administrator access is required, promote a verified account with the VPS-only admin promotion command before using migration controls.</p></section>}

    {data && <>
      <section className="v2-grid">
        <article className="v2-card"><span className="v2-card-label">AUDITED</span><h3>{data.summary.total}</h3><p>Legacy registry sites in the controlled inventory.</p></article>
        <article className="v2-card"><span className="v2-card-label">UNASSIGNED</span><h3>{data.summary.unassigned}</h3><p>Waiting for an administrator to map an existing verified customer account.</p></article>
        <article className="v2-card"><span className="v2-card-label">DRIFT</span><h3>{data.summary.drifted}</h3><p>Assigned records whose live legacy source changed after assignment and need review.</p></article>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading"><div><p>CONTROLLED INVENTORY</p><h2>Existing nnn websites</h2></div></div>
        <div className="v2-grid">
          {data.sites.map(site => <article className="v2-card" key={site.legacy_site_id}>
            <div className="v2-card-head"><div><span className="v2-card-label">{site.legacy_site_id}</span><h3>{site.display_domain}</h3></div><span className={`v2-state ${site.status === 'assigned' && site.drift_status !== 'drifted' ? 'good' : ''}`}>{site.drift_status === 'drifted' ? 'DRIFTED' : site.status.toUpperCase()}</span></div>
            <p>{site.hosts.join(' · ')}</p>
            <p><strong>Config:</strong> {site.customization_source === 'explicit' ? 'Explicit legacy override' : 'Inherited nnn defaults'}{site.free_bot_manifest_path ? ' · Site bot manifest preserved' : ''}</p>
            <p><strong>Source:</strong> {site.source_commit.slice(0, 12)} · audited {new Date(site.last_audited_at).toLocaleString()}</p>
            {site.assigned_owner ? <p><strong>Owner:</strong> {site.assigned_owner.display_name || site.assigned_owner.email} · {site.assigned_owner.email}</p> : <div style={{display:'grid',gap:8}}>
              <label>Verified owner email<input value={ownerEmails[site.legacy_site_id] || ''} onChange={event => setOwnerEmails(current => ({ ...current, [site.legacy_site_id]: event.target.value }))} placeholder="customer@example.com" type="email" /></label>
              <button className="v2-primary-button" type="button" disabled={busySite === site.legacy_site_id} onClick={() => void assign(site)}>{busySite === site.legacy_site_id ? 'Assigning…' : 'Assign to existing account'}</button>
            </div>}
          </article>)}
        </div>
      </section>
    </>}
  </>;
}
