import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { WebsiteRecord } from './websites';
import './builder.css';

type ThemeColors = {
  primary: string;
  secondary: string;
  nav_background: string;
  nav_text: string;
  header_background: string;
};

type NavigationFeature = { id: string; label: string; required?: boolean };

type BuilderConfig = {
  brand_name: string;
  tagline: string;
  logo_url: string;
  navigation: string[];
  colors: ThemeColors;
  deriv_client_id: string;
  deriv_scopes: string[];
  deriv_environment: 'production' | 'staging';
  setup_step: number;
  configuration_status: 'draft' | 'in_progress' | 'complete';
  completed_at?: string | null;
};

type BuilderWebsite = Pick<WebsiteRecord, 'id' | 'name' | 'site_key' | 'template_id' | 'status' | 'primary_domain' | 'domain_status' | 'deployment_status'>;

type BuilderPayload = {
  website: BuilderWebsite;
  config: BuilderConfig;
  readiness: { configuration_ready: boolean; deployment_ready: boolean; missing: string[] };
  bridge: {
    customization_path: string;
    customization: { version: number; site_id: string; navigation: string[]; colors: ThemeColors };
    registry_entry: Record<string, unknown> | null;
  };
};

type BuilderCatalog = {
  template_id: string;
  navigation_catalog: NavigationFeature[];
  defaults: { navigation: string[]; colors: ThemeColors; deriv_scopes: string[]; tagline: string };
};

type BuilderApiResponse = Partial<BuilderPayload & BuilderCatalog> & { message?: string };

async function builderRequest(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/v2/builder/${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let payload: BuilderApiResponse = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(payload.message || 'Website builder request failed.');
  return payload;
}

const STEPS = ['Identity', 'Appearance', 'Features', 'Deriv setup', 'Review'];

export function WebsiteBuilderView({ websiteId, onBack, onCompleted }: { websiteId: string; onBack: () => void; onCompleted: () => void }) {
  const [payload, setPayload] = useState<BuilderPayload | null>(null);
  const [catalog, setCatalog] = useState<BuilderCatalog | null>(null);
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [config, setConfig] = useState<BuilderConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([builderRequest(websiteId), builderRequest('catalog')])
      .then(([siteResult, catalogResult]) => {
        if (!active || !siteResult.website || !siteResult.config) return;
        const nextPayload = siteResult as BuilderPayload;
        setPayload(nextPayload);
        setConfig(nextPayload.config);
        setName(nextPayload.website.name);
        setStep(Math.min(5, Math.max(1, nextPayload.config.setup_step || 1)));
        setCatalog(catalogResult as BuilderCatalog);
      })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [websiteId]);

  const applyPayload = (result: BuilderApiResponse, nextStep?: number) => {
    if (result.website && result.config && result.readiness && result.bridge) {
      const next = result as BuilderPayload;
      setPayload(next);
      setConfig(next.config);
      setName(next.website.name);
    }
    if (nextStep) setStep(nextStep);
  };

  const save = async (section: string, body: unknown, nextStep: number) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await builderRequest(`${websiteId}/${section}`, { method: 'PUT', body: JSON.stringify(body) });
      applyPayload(result, nextStep);
      setMessage('Saved to your website draft.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await builderRequest(`${websiteId}/complete`, { method: 'POST', body: '{}' });
      applyPayload(result, 5);
      setMessage('Website configuration complete.');
      window.setTimeout(onCompleted, 350);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <section className="builder-loading">Loading website builder…</section>;
  if (!payload || !config || !catalog) return <section className="builder-error">{error || 'Website builder could not be loaded.'}<button type="button" onClick={onBack}>Back to My Websites</button></section>;

  const visibleFeatures = config.navigation.map(id => catalog.navigation_catalog.find(feature => feature.id === id)).filter(Boolean) as NavigationFeature[];
  const hiddenFeatures = catalog.navigation_catalog.filter(feature => !config.navigation.includes(feature.id));

  const moveFeature = (id: string, direction: -1 | 1) => {
    setConfig(current => {
      if (!current) return current;
      const navigation = [...current.navigation];
      const index = navigation.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= navigation.length) return current;
      [navigation[index], navigation[target]] = [navigation[target], navigation[index]];
      return { ...current, navigation };
    });
  };

  return (
    <div className="builder-page">
      <section className="builder-heading">
        <div>
          <button className="builder-back" type="button" onClick={onBack}>← My Websites</button>
          <p>CREATE WEBSITE V2 · {payload.website.site_key}</p>
          <h2>{payload.website.name}</h2>
          <span>Configure the reusable <strong>nnn</strong> template. A domain is not required to complete this stage.</span>
        </div>
        <div className="builder-head-state"><span>{config.configuration_status.replace(/_/g, ' ')}</span><strong>Step {step}/5</strong></div>
      </section>

      <nav className="builder-steps" aria-label="Website builder steps">
        {STEPS.map((label, index) => {
          const number = index + 1;
          return <button key={label} type="button" className={step === number ? 'active' : number < step ? 'done' : ''} onClick={() => setStep(number)}><span>{number < step ? '✓' : number}</span>{label}</button>;
        })}
      </nav>

      {error && <div className="builder-alert error">{error}</div>}
      {message && <div className="builder-alert success">{message}</div>}

      {step === 1 && <IdentityStep name={name} setName={setName} config={config} setConfig={setConfig} busy={busy} onContinue={() => void save('identity', { name, brand_name: config.brand_name, tagline: config.tagline, logo_url: config.logo_url }, 2)} />}
      {step === 2 && <AppearanceStep config={config} setConfig={setConfig} busy={busy} onBack={() => setStep(1)} onContinue={() => void save('appearance', { colors: config.colors }, 3)} />}
      {step === 3 && <FeaturesStep visible={visibleFeatures} hidden={hiddenFeatures} config={config} setConfig={setConfig} moveFeature={moveFeature} busy={busy} onBack={() => setStep(2)} onContinue={() => void save('features', { navigation: config.navigation }, 4)} />}
      {step === 4 && <DerivStep config={config} setConfig={setConfig} busy={busy} onBack={() => setStep(3)} onContinue={() => void save('deriv', { deriv_client_id: config.deriv_client_id, deriv_scopes: config.deriv_scopes, deriv_environment: config.deriv_environment }, 5)} />}
      {step === 5 && <ReviewStep payload={payload} config={config} busy={busy} onBack={() => setStep(4)} onFinish={() => void finish()} />}
    </div>
  );
}

function IdentityStep({ name, setName, config, setConfig, busy, onContinue }: { name: string; setName: (value: string) => void; config: BuilderConfig; setConfig: React.Dispatch<React.SetStateAction<BuilderConfig | null>>; busy: boolean; onContinue: () => void }) {
  return <BuilderCard kicker="STEP 1 · IDENTITY" title="Name and identify this website" description="These values belong to this customer website draft. Logo upload storage will be added in Step 5; for now an HTTPS logo URL can be saved.">
    <div className="builder-form-grid">
      <label>Website name<input value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label>
      <label>Brand name<input value={config.brand_name} maxLength={100} onChange={event => setConfig(current => current ? { ...current, brand_name: event.target.value } : current)} /></label>
      <label className="wide">Tagline<input value={config.tagline} maxLength={120} onChange={event => setConfig(current => current ? { ...current, tagline: event.target.value } : current)} /></label>
      <label className="wide">Logo URL <small>Optional · HTTPS only</small><input type="url" placeholder="https://example.com/logo.png" value={config.logo_url} onChange={event => setConfig(current => current ? { ...current, logo_url: event.target.value } : current)} /></label>
    </div>
    <div className="builder-brand-preview">
      <div className="builder-logo-preview">{config.logo_url ? <img src={config.logo_url} alt="Brand preview" /> : (config.brand_name || name).slice(0, 2).toUpperCase()}</div>
      <div><strong>{config.brand_name || name || 'Your brand'}</strong><span>{config.tagline || 'SMART DERIV TOOLS'}</span></div>
    </div>
    <BuilderActions busy={busy} onContinue={onContinue} continueLabel="Save & continue" />
  </BuilderCard>;
}

function AppearanceStep({ config, setConfig, busy, onBack, onContinue }: { config: BuilderConfig; setConfig: React.Dispatch<React.SetStateAction<BuilderConfig | null>>; busy: boolean; onBack: () => void; onContinue: () => void }) {
  const fields: Array<[keyof ThemeColors, string]> = [['primary', 'Primary'], ['secondary', 'Secondary'], ['nav_background', 'Navigation background'], ['nav_text', 'Navigation text'], ['header_background', 'Header background']];
  return <BuilderCard kicker="STEP 2 · APPEARANCE" title="Choose the website theme" description="These are the five per-site colors already consumed by the current nnn runtime.">
    <div className="builder-color-grid">{fields.map(([key, label]) => <label key={key}><span>{label}</span><div><input type="color" value={config.colors[key]} onChange={event => setConfig(current => current ? { ...current, colors: { ...current.colors, [key]: event.target.value } } : current)} /><input value={config.colors[key]} maxLength={7} onChange={event => setConfig(current => current ? { ...current, colors: { ...current.colors, [key]: event.target.value } } : current)} /></div></label>)}</div>
    <div className="builder-theme-preview" style={{ background: config.colors.nav_background, color: config.colors.nav_text }}>
      <div className="builder-preview-nav"><strong style={{ color: config.colors.secondary }}>{config.brand_name}</strong><span style={{ background: config.colors.primary }}>Dashboard</span><span>Free Bots</span><span>Auto Trades</span></div>
      <div className="builder-preview-body" style={{ background: config.colors.header_background }}><span style={{ color: config.colors.primary }}>LIVE TEMPLATE PREVIEW</span><strong>Trading workspace</strong><p>Theme changes are stored per website and projected into nnn site customization.</p></div>
    </div>
    <BuilderActions busy={busy} onBack={onBack} onContinue={onContinue} continueLabel="Save & continue" />
  </BuilderCard>;
}

function FeaturesStep({ visible, hidden, config, setConfig, moveFeature, busy, onBack, onContinue }: { visible: NavigationFeature[]; hidden: NavigationFeature[]; config: BuilderConfig; setConfig: React.Dispatch<React.SetStateAction<BuilderConfig | null>>; moveFeature: (id: string, direction: -1 | 1) => void; busy: boolean; onBack: () => void; onContinue: () => void }) {
  return <BuilderCard kicker="STEP 3 · FEATURES" title="Choose navigation and trading tools" description="Dashboard is mandatory. Everything else can be shown, hidden and ordered for this individual website.">
    <div className="builder-feature-list">{visible.map((feature, index) => <article key={feature.id}><span className="builder-order">{index + 1}</span><div><strong>{feature.label}</strong><small>{feature.id}</small></div><div className="builder-feature-actions"><button type="button" disabled={index === 0} onClick={() => moveFeature(feature.id, -1)}>↑</button><button type="button" disabled={index === visible.length - 1} onClick={() => moveFeature(feature.id, 1)}>↓</button><button type="button" disabled={feature.required} onClick={() => setConfig(current => current ? { ...current, navigation: current.navigation.filter(id => id !== feature.id) } : current)}>{feature.required ? 'Required' : 'Hide'}</button></div></article>)}</div>
    {!!hidden.length && <div className="builder-hidden-features"><span>HIDDEN FEATURES</span>{hidden.map(feature => <button key={feature.id} type="button" onClick={() => setConfig(current => current ? { ...current, navigation: [...current.navigation, feature.id] } : current)}>+ {feature.label}</button>)}</div>}
    <BuilderActions busy={busy} onBack={onBack} onContinue={onContinue} continueLabel="Save & continue" />
  </BuilderCard>;
}

function DerivStep({ config, setConfig, busy, onBack, onContinue }: { config: BuilderConfig; setConfig: React.Dispatch<React.SetStateAction<BuilderConfig | null>>; busy: boolean; onBack: () => void; onContinue: () => void }) {
  return <BuilderCard kicker="STEP 4 · DERIV SETUP" title="Prepare Deriv OAuth configuration" description="A customer may continue without an App/Client ID. It becomes mandatory before the website can be deployed for real trading.">
    <div className="builder-note"><strong>No domain yet? No problem.</strong><span>Leave the Client ID blank and continue. Step 5 will handle preview/readiness, and deployment later will enforce the missing domain and OAuth values.</span></div>
    <div className="builder-form-grid">
      <label className="wide">Deriv Client / App ID <small>Optional at this stage</small><input value={config.deriv_client_id} placeholder="Enter current Deriv OAuth client ID" onChange={event => setConfig(current => current ? { ...current, deriv_client_id: event.target.value } : current)} /></label>
      <label>Environment<select value={config.deriv_environment} onChange={event => setConfig(current => current ? { ...current, deriv_environment: event.target.value as 'production' | 'staging' } : current)}><option value="production">Production</option><option value="staging">Staging</option></select></label>
      <div className="builder-scope-box"><span>OAuth scopes</span><label><input type="checkbox" checked disabled /> trade <small>Required</small></label><label><input type="checkbox" checked={config.deriv_scopes.includes('application_read')} onChange={event => setConfig(current => current ? { ...current, deriv_scopes: event.target.checked ? [...new Set([...current.deriv_scopes, 'application_read'])] : current.deriv_scopes.filter(scope => scope !== 'application_read') } : current)} /> application_read</label></div>
    </div>
    <BuilderActions busy={busy} onBack={onBack} onContinue={onContinue} continueLabel="Save & review" />
  </BuilderCard>;
}

function ReviewStep({ payload, config, busy, onBack, onFinish }: { payload: BuilderPayload; config: BuilderConfig; busy: boolean; onBack: () => void; onFinish: () => void }) {
  const projected = useMemo(() => JSON.stringify(payload.bridge.customization, null, 2), [payload.bridge.customization]);
  return <BuilderCard kicker="STEP 5 · REVIEW" title="Review the website configuration" description="Completing this builder marks the website configuration ready. It does not deploy, start billing or require a domain.">
    <div className="builder-review-grid">
      <article><span>Brand</span><strong>{config.brand_name}</strong><small>{config.tagline}</small></article>
      <article><span>Features</span><strong>{config.navigation.length}</strong><small>visible nnn sections</small></article>
      <article><span>Domain</span><strong>{payload.website.primary_domain || 'Not connected'}</strong><small>{payload.website.primary_domain ? payload.website.domain_status : 'can be added later'}</small></article>
      <article><span>Deriv OAuth</span><strong>{config.deriv_client_id || 'Not configured'}</strong><small>{config.deriv_environment}</small></article>
    </div>
    <div className="builder-readiness"><div><span>CONFIGURATION</span><strong className={payload.readiness.configuration_ready ? 'ready' : ''}>{payload.readiness.configuration_ready ? 'READY' : 'INCOMPLETE'}</strong></div><div><span>DEPLOYMENT</span><strong className={payload.readiness.deployment_ready ? 'ready' : 'pending'}>{payload.readiness.deployment_ready ? 'READY' : 'WAITING FOR DOMAIN/OAUTH'}</strong></div></div>
    <section className="builder-bridge-preview"><div><span>NNN CONFIGURATION BRIDGE</span><strong>{payload.bridge.customization_path}</strong></div><pre>{projected}</pre></section>
    <div className="builder-note"><strong>Nothing is published yet.</strong><span>Step 5 will connect this completed draft to a private preview/runtime path and expand nnn branding so the customer can inspect the real template before domain/deployment work starts.</span></div>
    <BuilderActions busy={busy} onBack={onBack} onContinue={onFinish} continueLabel={config.configuration_status === 'complete' ? 'Configuration complete' : 'Complete website setup'} disabled={config.configuration_status === 'complete'} />
  </BuilderCard>;
}

function BuilderCard({ kicker, title, description, children }: { kicker: string; title: string; description: string; children: React.ReactNode }) {
  return <section className="builder-card"><header><p>{kicker}</p><h3>{title}</h3><span>{description}</span></header>{children}</section>;
}

function BuilderActions({ busy, onBack, onContinue, continueLabel, disabled = false }: { busy: boolean; onBack?: () => void; onContinue: () => void; continueLabel: string; disabled?: boolean }) {
  return <div className="builder-actions">{onBack && <button type="button" onClick={onBack}>Back</button>}<button className="v2-primary-button" type="button" disabled={busy || disabled} onClick={onContinue}>{busy ? 'Saving…' : continueLabel}</button></div>;
}
