import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import './runtime-preview.css';

type PreviewBuilderPayload = {
  website: {
    id: string;
    name: string;
    site_key: string;
    status: string;
    primary_domain?: string | null;
    domain_status: string;
    deployment_status: string;
  };
  config: {
    brand_name: string;
    tagline: string;
    logo_url: string;
    navigation: string[];
    colors: Record<string, string>;
    deriv_client_id: string;
    configuration_status: string;
  };
  readiness: {
    configuration_ready: boolean;
    deployment_ready: boolean;
    missing: string[];
  };
};

type PreviewSession = {
  landing_preview_url: string;
  app_preview_url: string;
  expires_at: string;
};

async function jsonRequest(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.message || 'Request failed.'));
  return payload;
}

export function RuntimePreviewView({ websiteId, onBack, onEditSetup }: { websiteId: string; onBack: () => void; onEditSetup: () => void }) {
  const [payload, setPayload] = useState<PreviewBuilderPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const result = await jsonRequest(`/api/v2/builder/${websiteId}`);
    setPayload(result as PreviewBuilderPayload);
  }, [websiteId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load()
      .catch(err => { if (active) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/v2/preview/${websiteId}/logo`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(result?.message || 'Logo upload failed.'));
      await load();
      setMessage('Logo uploaded to VPS storage and linked to this website.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const openPreview = async (screen: 'landing' | 'app') => {
    const previewWindow = window.open('', '_blank', 'noopener,noreferrer');
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await jsonRequest(`/api/v2/preview/${websiteId}/session`, { method: 'POST', body: '{}' }) as PreviewSession;
      const url = screen === 'app' ? result.app_preview_url : result.landing_preview_url;
      setExpiresAt(result.expires_at || '');
      if (previewWindow) previewWindow.location.href = url;
      else window.location.assign(url);
      setMessage('Private nnn preview session created. It refreshes Site Manager configuration while open.');
    } catch (err) {
      previewWindow?.close();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <section className="runtime-preview-loading">Loading preview workspace…</section>;
  if (!payload) return <section className="runtime-preview-error">{error || 'Preview workspace could not be loaded.'}<button type="button" onClick={onBack}>Back</button></section>;

  const { website, config, readiness } = payload;
  const logo = config.logo_url;

  return (
    <div className="runtime-preview-page">
      <section className="runtime-preview-heading">
        <div>
          <button type="button" className="runtime-preview-back" onClick={onBack}>← My Websites</button>
          <p>STEP 5 · REAL NNN RUNTIME</p>
          <h2>{config.brand_name || website.name}</h2>
          <span>{website.site_key} · private preview does not require a domain</span>
        </div>
        <div className="runtime-preview-state">
          <span>{config.configuration_status.replace(/_/g, ' ')}</span>
          <strong>{readiness.configuration_ready ? 'CONFIG READY' : 'DRAFT'}</strong>
        </div>
      </section>

      {error && <div className="runtime-preview-alert error">{error}</div>}
      {message && <div className="runtime-preview-alert success">{message}</div>}

      <section className="runtime-preview-grid">
        <article className="runtime-preview-card runtime-preview-brand-card">
          <p>BRANDING</p>
          <h3>Logo stored on the VPS</h3>
          <div className="runtime-preview-brand">
            <div className="runtime-preview-logo">{logo ? <img src={logo} alt={`${config.brand_name} logo`} /> : (config.brand_name || website.name).slice(0, 2).toUpperCase()}</div>
            <div><strong>{config.brand_name}</strong><span>{config.tagline}</span></div>
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void uploadLogo(event)} hidden />
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>{logo ? 'Replace logo' : 'Upload logo'}</button>
          <small>PNG, JPEG or WebP · maximum 2 MB. Stored under the website's VPS asset folder.</small>
        </article>

        <article className="runtime-preview-card">
          <p>LIVE CONFIG CHANNEL</p>
          <h3>Site Manager → nnn</h3>
          <dl>
            <div><dt>Brand</dt><dd>{config.brand_name}</dd></div>
            <div><dt>Navigation</dt><dd>{config.navigation.length} sections</dd></div>
            <div><dt>Theme colors</dt><dd>{Object.keys(config.colors).length}</dd></div>
            <div><dt>Deriv client</dt><dd>{config.deriv_client_id ? 'Configured' : 'Not yet required'}</dd></div>
            <div><dt>Domain</dt><dd>{website.primary_domain || 'Not required for preview'}</dd></div>
          </dl>
          <small>The nnn preview polls the VPS runtime config, so saved manager changes can appear without publishing a Git commit.</small>
        </article>

        <article className="runtime-preview-card">
          <p>READINESS</p>
          <h3>Preview before deployment</h3>
          <dl>
            <div><dt>Configuration</dt><dd>{readiness.configuration_ready ? 'Ready' : 'Incomplete'}</dd></div>
            <div><dt>Deployment</dt><dd>{readiness.deployment_ready ? 'Ready' : 'Waiting'}</dd></div>
            <div><dt>Billing</dt><dd>Not started</dd></div>
            <div><dt>Public deploy</dt><dd>Not triggered</dd></div>
          </dl>
          <button type="button" onClick={onEditSetup}>Edit website setup</button>
        </article>
      </section>

      <section className="runtime-preview-launcher">
        <div>
          <p>PRIVATE PREVIEW</p>
          <h3>Open the actual nnn template</h3>
          <span>Landing preview shows the public entrance. App preview opens the configured trading workspace with trading/OAuth disabled for safety.</span>
          {expiresAt && <small>Current preview session expires {new Date(expiresAt).toLocaleString()}.</small>}
        </div>
        <div className="runtime-preview-actions">
          <button type="button" disabled={busy} onClick={() => void openPreview('landing')}>Preview landing page</button>
          <button className="primary" type="button" disabled={busy} onClick={() => void openPreview('app')}>Preview nnn app</button>
        </div>
      </section>
    </div>
  );
}
