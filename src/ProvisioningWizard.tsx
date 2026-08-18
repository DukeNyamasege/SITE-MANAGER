import { useEffect, useMemo, useState } from 'react';
import { ApiError, api, delay } from './api';
import type {
  Domain,
  DomainVerificationResponse,
  InfrastructureResponse,
  ManagerItem,
  NavigationFeature,
  OnboardingResponse,
  PublishResponse,
  PublishStatusResponse,
  ThemeColors,
} from './types';

const COLOR_FIELDS: Array<{ key: keyof ThemeColors; label: string }> = [
  { key: 'primary', label: 'Primary color' },
  { key: 'secondary', label: 'Secondary color' },
  { key: 'nav_background', label: 'Navigation background' },
  { key: 'nav_text', label: 'Navigation text' },
  { key: 'header_background', label: 'Header background' },
];

const itemName = (item: ManagerItem) => item.kind === 'upload'
  ? item.name
  : item.bot.name || item.bot.title || item.bot.file;

const move = <T,>(items: T[], from: number, to: number) => {
  if (to < 0 || to >= items.length) return items;
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
};

export default function ProvisioningWizard({
  site,
  onComplete,
  onChangeDomain,
}: {
  site: Domain;
  onComplete: () => Promise<void>;
  onChangeDomain: () => Promise<void>;
}) {
  const [boot, setBoot] = useState<OnboardingResponse | null>(null);
  const [step, setStep] = useState(1);
  const [clientId, setClientId] = useState('');
  const [legacyAppId, setLegacyAppId] = useState('');
  const [environment, setEnvironment] = useState<'production' | 'staging'>('production');
  const [scopes, setScopes] = useState<string[]>(['trade', 'application_read']);
  const [catalog, setCatalog] = useState<NavigationFeature[]>([]);
  const [navigation, setNavigation] = useState<string[]>([]);
  const [colors, setColors] = useState<ThemeColors | null>(null);
  const [items, setItems] = useState<ManagerItem[]>([]);
  const [featureToAdd, setFeatureToAdd] = useState('');
  const [verification, setVerification] = useState<DomainVerificationResponse | null>(null);
  const [checkingVerification, setCheckingVerification] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkingInfrastructure, setCheckingInfrastructure] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [infrastructure, setInfrastructure] = useState<InfrastructureResponse | null>(null);

  useEffect(() => {
    let alive = true;
    api<OnboardingResponse>('onboarding')
      .then(payload => {
        if (!alive) return;
        setBoot(payload);
        if (payload.status === 'configured') return;
        setCatalog(payload.catalog || []);
        setNavigation(payload.navigation || []);
        setColors(payload.colors || null);
        setScopes(payload.recommended_scopes || ['trade', 'application_read']);
        void api<DomainVerificationResponse>('domain-verification')
          .then(result => alive && setVerification(result))
          .catch(err => alive && setError(err instanceof Error ? err.message : String(err)));
      })
      .catch(err => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => { alive = false; };
  }, []);

  const catalogById = useMemo(() => new Map(catalog.map(feature => [feature.id, feature])), [catalog]);
  const visibleFeatures = useMemo(
    () => navigation.map(id => catalogById.get(id)).filter((value): value is NavigationFeature => Boolean(value)),
    [catalogById, navigation]
  );
  const hiddenFeatures = useMemo(() => catalog.filter(feature => !navigation.includes(feature.id)), [catalog, navigation]);

  const toggleScope = (scope: string) => {
    if (scope === 'trade') return;
    setScopes(current => current.includes(scope) ? current.filter(item => item !== scope) : [...current, scope]);
  };

  const checkVerification = async () => {
    if (checkingVerification) return verification;
    setCheckingVerification(true);
    setError('');
    try {
      const result = await api<DomainVerificationResponse>('domain-verification', { method: 'POST' });
      setVerification(result);
      if (!result.verified) setError(result.message || 'Domain ownership is not verified yet.');
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setCheckingVerification(false);
    }
  };

  const addFiles = async (files: FileList | File[]) => {
    const next: ManagerItem[] = [];
    const problems: string[] = [];
    for (const file of Array.from(files)) {
      if (!file.name.toLowerCase().endsWith('.xml')) { problems.push(`${file.name}: only .xml files are accepted.`); continue; }
      if (file.size > 1_500_000) { problems.push(`${file.name}: file is larger than 1.5 MB.`); continue; }
      const xml = await file.text();
      if (!/<xml[\s>]/i.test(xml) || !/<block[\s>]/i.test(xml)) { problems.push(`${file.name}: not a Blockly XML strategy.`); continue; }
      next.push({ kind: 'upload', temp_id: crypto.randomUUID(), file_name: file.name, name: file.name.replace(/\.xml$/i, ''), xml });
    }
    if (next.length) setItems(current => [...current, ...next]);
    setError(problems.join(' '));
  };

  const waitForPublish = async (created: PublishResponse) => {
    if (!created.pr) throw new Error('Provisioning did not return a pull request number.');
    setStatus(`PR #${created.pr} created. Waiting for Node 22/24 validation…`);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await delay(3000);
      const result = await api<PublishStatusResponse>(`publish-status?pr=${created.pr}`);
      setStatus(result.message);
      if (result.status === 'merged') return;
      if (result.status === 'failed') throw new Error(result.message);
    }
    throw new Error('Validation is still running. Check the GitHub PR before trying again.');
  };

  const checkInfrastructure = async () => {
    if (checkingInfrastructure) return;
    setCheckingInfrastructure(true);
    setError('');
    try {
      const result = await api<InfrastructureResponse>('provision-infrastructure', { method: 'POST' });
      setInfrastructure(result);
      setStatus(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingInfrastructure(false);
    }
  };

  const provision = async () => {
    if (!colors || busy) return;
    if (!verification?.verified) {
      setError('Verify domain ownership before deploying the site.');
      setStep(1);
      return;
    }
    if (!clientId.trim()) {
      setError('Enter the Deriv OAuth client/App ID before deploying.');
      setStep(2);
      return;
    }

    setBusy(true);
    setError('');
    setStatus('Creating the new-site validation PR…');
    setInfrastructure(null);
    setStep(6);
    try {
      const created = await api<PublishResponse>('provision-site', {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId.trim(),
          legacy_app_id: legacyAppId.trim(),
          environment,
          scopes,
          navigation,
          colors,
          items,
        }),
      });
      if (created.status !== 'already_configured') await waitForPublish(created);
      setStatus('Source configuration is live on main. Asking Netlify to attach the custom domain…');
      const infra = await api<InfrastructureResponse>('provision-infrastructure', { method: 'POST' });
      setInfrastructure(infra);
      setStatus(infra.message);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError('Domain session expired. Change domain and start again.');
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!boot) return <main className="loading-shell"><div className="spinner" />Preparing new site…</main>;

  if (boot.status === 'configured') {
    return (
      <main className="login-shell">
        <section className="login-card onboarding-finished">
          <div className="brand-mark">SM</div>
          <p className="eyebrow">SITE CONFIGURED</p>
          <h1>{site.display_domain}</h1>
          <p className="muted">The domain now exists in the managed site registry.</p>
          <button className="primary-button" onClick={() => void onComplete()}>Open website wizard</button>
        </section>
      </main>
    );
  }

  const steps = ['Verify domain', 'Deriv setup', 'Navigation', 'Bots', 'Review', 'Deploy'];

  return (
    <div className="app-shell onboarding-shell">
      <header className="topbar">
        <div className="topbar-brand"><div className="brand-mark small">SM</div><div><strong>New Site Setup</strong><small>{site.display_domain}</small></div></div>
        <button className="ghost-button" type="button" onClick={() => void onChangeDomain()}>Change domain</button>
      </header>

      <main className="workspace onboarding-workspace">
        <section className="hero">
          <p className="eyebrow">NETLIFY-ONLY SITE PROVISIONING</p>
          <h1>Build {site.display_domain}</h1>
          <p>Configure the website in SITE-MANAGER. GitHub and Netlify are automated; registrar DNS remains a simple manual step.</p>
        </section>

        <nav className="wizard-nav wizard-nav--six" aria-label="Setup steps">
          {steps.map((label, index) => <button key={label} type="button" className={step === index + 1 ? 'is-active' : ''} onClick={() => setStep(index + 1)}><span>{index + 1}</span>{label}</button>)}
        </nav>

        {error && <div className="alert error global-alert">{error}</div>}

        {step === 1 && (
          <section className="manager-card wizard-card">
            <div className="section-head"><div><span className="step">1</span><div><strong>Verify domain ownership</strong><small>One manual DNS TXT record protects new-site creation</small></div></div></div>
            <div className="review-grid"><div><small>Domain</small><strong>{site.display_domain}</strong></div><div><small>Status</small><strong>{verification?.verified ? 'Verified' : 'Waiting for DNS TXT'}</strong></div></div>
            {verification?.verified ? (
              <div className="alert success">Domain ownership is verified. You can continue.</div>
            ) : verification?.record ? (
              <div className="dns-records">
                <h3>Add this verification record at your DNS provider</h3>
                <code>{verification.record.host} {verification.record.type} → {verification.record.value}</code>
                <small>After saving the record, wait for DNS propagation and press Check ownership.</small>
              </div>
            ) : <div className="empty-state">Preparing verification record…</div>}
            <div className="wizard-actions"><button className="secondary-button" type="button" disabled={checkingVerification} onClick={() => void checkVerification()}>{checkingVerification ? 'Checking…' : 'Check ownership'}</button><button className="primary-button" type="button" disabled={!verification?.verified} onClick={() => setStep(2)}>Continue</button></div>
          </section>
        )}

        {step === 2 && (
          <section className="manager-card wizard-card">
            <div className="section-head"><div><span className="step">2</span><div><strong>Deriv OAuth setup</strong><small>Use the application values registered for this exact domain</small></div></div></div>
            <div className="wizard-grid">
              <label>Domain<input value={site.display_domain} disabled /></label>
              <label>Website URL<input value={site.website_url} disabled /></label>
              <label>Redirect URI<input value={site.redirect_uri || `${site.website_url}/callback`} disabled /></label>
              <label>Environment<select value={environment} onChange={event => setEnvironment(event.target.value as 'production' | 'staging')}><option value="production">Production</option><option value="staging">Staging</option></select></label>
              <label className="wizard-span-2">Deriv OAuth client / App ID<input value={clientId} onChange={event => setClientId(event.target.value)} autoComplete="off" placeholder="Paste the registered client/App ID" /></label>
              <label className="wizard-span-2">Legacy App ID <small>(optional)</small><input value={legacyAppId} onChange={event => setLegacyAppId(event.target.value)} autoComplete="off" /></label>
            </div>
            <div className="scope-list">{['trade', 'application_read', 'account_manage', 'payment'].map(scope => <label key={scope}><input type="checkbox" checked={scopes.includes(scope)} disabled={scope === 'trade'} onChange={() => toggleScope(scope)} /><span><strong>{scope}</strong><small>{scope === 'trade' ? 'Required for trading' : 'Enable only if the registered app needs it'}</small></span></label>)}</div>
            <div className="wizard-actions"><button className="ghost-button" onClick={() => setStep(1)}>Back</button><button className="primary-button" disabled={!clientId.trim()} onClick={() => setStep(3)}>Continue</button></div>
          </section>
        )}

        {step === 3 && colors && (
          <section className="manager-card wizard-card">
            <div className="section-head"><div><span className="step">3</span><div><strong>Navigation & appearance</strong><small>Choose only features that already exist in the trading template</small></div></div></div>
            <div className="wizard-list">{visibleFeatures.map((feature, index) => <article className="wizard-list-row" key={feature.id}><span className="bot-order">{index + 1}</span><div><strong>{feature.label}</strong><small>{feature.id}</small></div><div className="row-actions"><button type="button" disabled={index === 0} onClick={() => setNavigation(current => move(current, index, index - 1))}>↑</button><button type="button" disabled={index === navigation.length - 1} onClick={() => setNavigation(current => move(current, index, index + 1))}>↓</button><button type="button" disabled={feature.required} onClick={() => !feature.required && setNavigation(current => current.filter(id => id !== feature.id))}>{feature.required ? 'Required' : 'Remove'}</button></div></article>)}</div>
            <div className="add-feature-row"><select value={featureToAdd} onChange={event => setFeatureToAdd(event.target.value)}><option value="">{hiddenFeatures.length ? 'Add a hidden feature' : 'All features are visible'}</option>{hiddenFeatures.map(feature => <option key={feature.id} value={feature.id}>{feature.label}</option>)}</select><button className="secondary-button" type="button" disabled={!featureToAdd} onClick={() => { if (featureToAdd) setNavigation(current => [...current, featureToAdd]); setFeatureToAdd(''); }}>Add feature</button></div>
            <div className="theme-preview" style={{ background: colors.nav_background, color: colors.nav_text }}><span style={{ background: colors.primary, color: '#fff' }}>Active item</span><span style={{ color: colors.secondary }}>◆ Accent</span><span>Navigation text</span></div>
            <div className="color-grid">{COLOR_FIELDS.map(field => <label className="color-field" key={field.key}><div><strong>{field.label}</strong></div><div className="color-inputs"><input type="color" value={colors[field.key]} onChange={event => setColors(current => current ? { ...current, [field.key]: event.target.value.toLowerCase() } : current)} /><input type="text" value={colors[field.key]} maxLength={7} onChange={event => setColors(current => current ? { ...current, [field.key]: event.target.value.toLowerCase() } : current)} /></div></label>)}</div>
            <div className="wizard-actions"><button className="ghost-button" onClick={() => setStep(2)}>Back</button><button className="primary-button" onClick={() => setStep(4)}>Continue</button></div>
          </section>
        )}

        {step === 4 && (
          <section className="manager-card wizard-card">
            <div className="section-head"><div><span className="step">4</span><div><strong>Initial bot library</strong><small>Optional — upload bots now or later from the existing-site wizard</small></div></div><span className="count-pill">{items.length} BOT{items.length === 1 ? '' : 'S'}</span></div>
            <label className="upload-zone"><input type="file" accept=".xml,text/xml,application/xml" multiple onChange={event => { if (event.target.files) void addFiles(event.target.files); event.target.value = ''; }} /><span className="upload-icon">＋</span><strong>Browse XML files</strong><small>Select one or several Blockly strategy files</small></label>
            <div className="wizard-list">{items.map((item, index) => <article className="wizard-list-row" key={item.kind === 'upload' ? item.temp_id : item.bot.id || item.bot.file}><span className="bot-order">{index + 1}</span><div><strong>{itemName(item)}</strong><small>{item.kind === 'upload' ? item.file_name : item.bot.file}</small></div><div className="row-actions"><button disabled={index === 0} onClick={() => setItems(current => move(current, index, index - 1))}>↑</button><button disabled={index === items.length - 1} onClick={() => setItems(current => move(current, index, index + 1))}>↓</button><button onClick={() => setItems(current => current.filter((_, position) => position !== index))}>Delete</button></div></article>)}{!items.length && <div className="empty-state">No initial bots selected. The new site will start with an empty domain bot library.</div>}</div>
            <div className="wizard-actions"><button className="ghost-button" onClick={() => setStep(3)}>Back</button><button className="primary-button" onClick={() => setStep(5)}>Review</button></div>
          </section>
        )}

        {step === 5 && colors && (
          <section className="manager-card wizard-card">
            <div className="section-head"><div><span className="step">5</span><div><strong>Review deployment</strong><small>GitHub and Netlify are automated; DNS is manual</small></div></div></div>
            <div className="review-grid"><div><small>Domain</small><strong>{site.display_domain}</strong></div><div><small>Ownership</small><strong>{verification?.verified ? 'Verified' : 'Not verified'}</strong></div><div><small>Deriv client</small><strong>{clientId || 'Not entered'}</strong></div><div><small>Redirect</small><strong>{site.redirect_uri}</strong></div><div><small>Navigation</small><strong>{navigation.length} items</strong></div><div><small>Initial bots</small><strong>{items.length}</strong></div><div><small>Netlify alias API</small><strong>{boot.infrastructure?.netlify_automation ? 'Ready' : 'Needs environment variables'}</strong></div><div><small>DNS</small><strong>Manual by design</strong></div></div>
            <div className="alert info">The Deriv application itself must already be registered with the exact HTTPS redirect URI. SITE-MANAGER stores the configuration but does not create the Deriv application.</div>
            <div className="wizard-actions"><button className="ghost-button" onClick={() => setStep(4)}>Back</button><button className="primary-button" disabled={!verification?.verified || !clientId.trim() || busy} onClick={() => void provision()}>{busy ? 'Deploying…' : 'Deploy website'}</button></div>
          </section>
        )}

        {step === 6 && (
          <section className="manager-card wizard-card deployment-card">
            <div className="section-head"><div><span className="step">6</span><div><strong>Deployment & manual DNS</strong><small>GitHub → Netlify alias → your DNS provider → SSL</small></div></div></div>
            {status && <div className="publish-status">{(busy || checkingInfrastructure) && <div className="spinner small-spinner" />}{status}</div>}
            {infrastructure?.netlify && <div className="alert success">Netlify aliases are configured for {infrastructure.domain}. Target: {infrastructure.netlify.hostname}</div>}
            {infrastructure?.dns_records && (
              <div className="dns-records">
                <h3>Manual DNS records</h3>
                <p>Add these at Namecheap or whichever DNS provider owns the domain. SITE-MANAGER will not edit registrar DNS.</p>
                <code>@ {infrastructure.dns_records.apex.type} → {infrastructure.dns_records.apex.value}</code>
                <code>www {infrastructure.dns_records.www.type} → {infrastructure.dns_records.www.value}</code>
                <small>If your provider does not support ALIAS at the apex, use A → {infrastructure.dns_records.apex_fallback.value}.</small>
              </div>
            )}
            {infrastructure?.status === 'domain_connected' && <div className="alert success">Netlify accepted the domain/TLS setup. The site can become live as DNS finishes propagating.</div>}
            <div className="wizard-actions">
              {infrastructure?.status !== 'domain_connected' && <button className="secondary-button" type="button" disabled={checkingInfrastructure || busy} onClick={() => void checkInfrastructure()}>{checkingInfrastructure ? 'Checking…' : 'Check DNS & SSL'}</button>}
              <button className="primary-button" type="button" onClick={() => void onComplete()}>Continue to website wizard</button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
