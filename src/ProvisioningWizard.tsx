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
      if (!file.name.toLowerCase().endsWith('.xml')) {
        problems.push(`${file.name}: only .xml files are accepted.`);
        continue;
      }
      if (file.size > 1_500_000) {
        problems.push(`${file.name}: file is larger than 1.5 MB.`);
        continue;
      }
      const xml = await file.text();
      if (!/<xml[\s>]/i.test(xml) || !/<block[\s>]/i.test(xml)) {
        problems.push(`${file.name}: not a Blockly XML strategy.`);
        continue;
      }
      next.push({
        kind: 'upload',
        temp_id: crypto.randomUUID(),
        file_name: file.name,
        name: file.name.replace(/\.xml$/i, ''),
        xml,
      });
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
    throw new Error('Validation is still running. Open the GitHub PR to inspect the workflow.');
  };

  const provision = async () => {
    if (!colors || busy) return;
    if (!clientId.trim()) {
      setError('Enter the Deriv OAuth client/app ID before deploying.');
      setStep(1);
      return;
    }

    let ownership = verification;
    if (!ownership?.verified) ownership = await checkVerification();
    if (!ownership?.verified) {
      setError('Verify that you control this domain before deploying it.');
      setStep(4);
      return;
    }

    setBusy(true);
    setError('');
    setStatus('Creating the new-site validation PR…');
    setInfrastructure(null);
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
      setStatus('Source configuration is live on main. Connecting the custom domain…');
      const infra = await api<InfrastructureResponse>('provision-infrastructure', { method: 'POST' });
      setInfrastructure(infra);
      setStatus(infra.message);
      setStep(5);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError('Domain session expired. Change domain and start again.');
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!boot) {
    return <main className="loading-shell"><div className="spinner" />Preparing new site…</main>;
  }

  if (boot.status === 'configured') {
    return (
      <main className="login-shell">
        <section className="login-card onboarding-finished">
          <div className="brand-mark">SM</div>
          <p className="eyebrow">SITE CONFIGURED</p>
          <h1>{site.display_domain}</h1>
          <p className="muted">The domain now exists in the managed site registry.</p>
          <button className="primary-button" onClick={() => void onComplete()}>Open site manager</button>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell onboarding-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="brand-mark small">SM</div>
          <div><strong>New Site Setup</strong><small>{site.display_domain}</small></div>
        </div>
        <button className="ghost-button" type="button" onClick={() => void onChangeDomain()}>Change domain</button>
      </header>

      <main className="workspace onboarding-workspace">
        <section className="hero">
          <p className="eyebrow">SELF-SERVICE SITE PROVISIONING</p>
          <h1>Build {site.display_domain}</h1>
          <p>Complete the Deriv settings, choose the navigation and colors, add initial bots, verify domain ownership, then deploy through GitHub validation and Netlify.</p>
        </section>

        <nav className="wizard-nav" aria-label="Setup steps">
          {['Deriv setup', 'Navigation', 'Bots', 'Review', 'Deploy'].map((label, index) => (
            <button key={label} type="button" className={step === index + 1 ? 'is-active' : ''} onClick={() => setStep(index + 1)}>
              <span>{index + 1}</span>{label}
            </button>
          ))}
        </nav>

        {error && <div className="alert error global-alert">{error}</div>}

        {step === 1 && (
          <section className="manager-card wizard-card">
            <div className="section-head"><div><span className="step">1</span><div><strong>Domain & Deriv OAuth</strong><small>Use the values registered at developers.deriv.com</small></div></div></div>
            <div className="wizard-grid">
              <label>Domain<input value={site.display_domain} disabled /></label>
              <label>Website URL<input value={site.website_url} disabled /></label>
              <label>Redirect URI<input value={site.redirect_uri || `${site.website_url}/callback`} disabled /></label>
              <label>Environment<select value={environment} onChange={event => setEnvironment(event.target.value as 'production' | 'staging')}><option value="production">Production</option><option value="staging">Staging</option></select></label>
              <label className="wizard-span-2">Deriv OAuth client / App ID<input value={clientId} onChange={event => setClientId(event.target.value)} autoComplete="off" placeholder="Paste the registered OAuth client ID" /></label>
              <label className="wizard-span-2">Legacy App ID <small>(optional)</small><input value={legacyAppId} onChange={event => setLegacyAppId(event.target.value)} autoComplete="off" /></label>
            </div>
            <div className="scope-list">
              {['trade', 'application_read', 'account_manage', 'payment'].map(scope => (
                <label key={scope}><input type="checkbox" checked={scopes.includes(scope)} disabled={scope === 'trade'} onChange={() => toggleScope(scope)} /><span><strong>{scope}</strong><small>{scope === 'trade' ? 'Required for trading' : 'Enable only if your registered app needs this scope'}</small></span></label>
              ))}
            </div>
            <div className="wizard-actions"><button className="primary-button" type="button" onClick={() => setStep(2)}>Continue</button></div>
          </section>
        )}

        {step === 2 && colors && (
          <section className="manager-card wizard-card">
            <div className="section-head"><div><span className="step">2</span><div><strong>Navigation & appearance</strong><small>Remove, restore and arrange only features that exist in the template</small></div></div></div>
            <div className="wizard-list">
              {visibleFeatures.map((feature, index) => (
                <article className="wizard-list-row" key={feature.id}>
                  <span className="bot-order">{index + 1}</span>
                  <div><strong>{feature.label}</strong><small>{feature.id}</small></div>
                  <div className="row-actions">
                    <button type="button" disabled={index === 0} onClick={() => setNavigation(current => move(current, index, index - 1))}>↑</button>
                    <button type="button" disabled={index === navigation.length - 1} onClick={() => setNavigation(current => move(current, index, index + 1))}>↓</button>
                    <button type="button" disabled={feature.required} onClick={() => !feature.required && setNavigation(current => current.filter(id => id !== feature.id))}>{feature.required ? 'Required' : 'Remove'}</button>
                  </div>
                </article>
              ))}
            </div>
            <div className="add-feature-row">
              <select value={featureToAdd} onChange={event => setFeatureToAdd(event.target.value)}><option value="">{hiddenFeatures.length ? 'Add a hidden feature' : 'All features are visible'}</option>{hiddenFeatures.map(feature => <option key={feature.id} value={feature.id}>{feature.label}</option>)}</select>
              <button className="secondary-button" type="button" disabled={!featureToAdd} onClick={() => { if (featureToAdd) setNavigation(current => [...current, featureToAdd]); setFeatureToAdd(''); }}>Add feature</button>
            </div>
            <div className="theme-preview" style={{ background: colors.nav_background, color: colors.nav_text }}><span style={{ background: colors.primary, color: '#fff' }}>Active item</span><span style={{ color: colors.secondary }}>◆ Accent</span><span>Navigation text</span></div>
            <div className="color-grid">
              {COLOR_FIELDS.map(field => (
                <label className="color-field" key={field.key}>
                  <div><strong>{field.label}</strong></div>
                  <div className="color-inputs"><input type="color" value={colors[field.key]} onChange={event => setColors(current => current ? { ...current, [field.key]: event.target.value.toLowerCase() } : current)} /><input type="text" value={colors[field.key]} maxLength={7} onChange={event => setColors(current => current ? { ...current, [field.key]: event.target.value.toLowerCase() } : current)} /></div>
                </label>
              ))}
            </div>
            <div className="wizard-actions"><button className="ghost-button" type="button" onClick={() => setStep(1)}>Back</button><button className="primary-button" type="button" onClick={() => setStep(3)}>Continue</button></div>
          </section>
        )}

        {step === 3 && (
          <section className="manager-card wizard-card">
            <div className="section-head"><div><span className="step">3</span><div><strong>Initial bot library</strong><small>Optional — upload XML bots now or add them later</small></div></div><span className="count-pill">{items.length} BOT{items.length === 1 ? '' : 'S'}</span></div>
            <label className="upload-zone"><input type="file" accept=".xml,text/xml,application/xml" multiple onChange={event => { if (event.target.files) void addFiles(event.target.files); event.target.value = ''; }} /><span className="upload-icon">＋</span><strong>Browse XML files</strong><small>Select one or several Blockly strategy files</small></label>
            <div className="wizard-list">
              {items.map((item, index) => (
                <article className="wizard-list-row" key={item.kind === 'upload' ? item.temp_id : item.bot.id || item.bot.file}>
                  <span className="bot-order">{index + 1}</span><div><strong>{itemName(item)}</strong><small>{item.kind === 'upload' ? item.file_name : item.bot.file}</small></div>
                  <div className="row-actions"><button type="button" disabled={index === 0} onClick={() => setItems(current => move(current, index, index - 1))}>↑</button><button type="button" disabled={index === items.length - 1} onClick={() => setItems(current => move(current, index, index + 1))}>↓</button><button type="button" onClick={() => setItems(current => current.filter((_, position) => position !== index))}>Delete</button></div>
                </article>
              ))}
              {!items.length && <div className="empty-state">No initial bots selected. The new site will start with an empty domain bot library.</div>}
            </div>
            <div className="wizard-actions"><button className="ghost-button" type="button" onClick={() => setStep(2)}>Back</button><button className="primary-button" type="button" onClick={() => setStep(4)}>Review</button></div>
          </section>
        )}

        {step === 4 && colors && (
          <section className="manager-card wizard-card">
            <div className="section-head"><div><span className="step">4</span><div><strong>Review deployment</strong><small>No changes reach the target main branch until validation passes</small></div></div></div>
            <div className="review-grid">
              <div><small>Domain</small><strong>{site.display_domain}</strong></div><div><small>Site ID</small><strong>{site.id}</strong></div><div><small>Deriv client</small><strong>{clientId || 'Not entered'}</strong></div><div><small>Redirect</small><strong>{site.redirect_uri}</strong></div><div><small>OAuth scopes</small><strong>{scopes.join(', ')}</strong></div><div><small>Navigation</small><strong>{navigation.length} items</strong></div><div><small>Initial bots</small><strong>{items.length}</strong></div><div><small>Netlify alias automation</small><strong>{boot.infrastructure?.netlify_automation ? 'Ready' : 'Needs environment variables'}</strong></div>
            </div>
            <div className="alert info">The Deriv OAuth application itself must already be registered with the exact HTTPS redirect URI shown above. The manager stores the client ID and site configuration; it does not create the Deriv application.</div>

            <div className={`ownership-card ${verification?.verified ? 'is-verified' : ''}`}>
              <div>
                <strong>Domain ownership</strong>
                <small>{verification?.verified ? verification.message || 'Verified.' : 'The domain must be verified before SITE-MANAGER can add it to the production registry.'}</small>
              </div>
              {verification?.verified ? (
                <span className="ownership-status">VERIFIED</span>
              ) : (
                <>
                  {verification?.record && (
                    <div className="ownership-record">
                      <p>If this domain is not in the connected Namecheap account, add this TXT record at its current DNS provider:</p>
                      <code>{verification.record.host} TXT → {verification.record.value}</code>
                      <small>Full record: {verification.record.name}</small>
                    </div>
                  )}
                  <button className="secondary-button" type="button" disabled={checkingVerification} onClick={() => void checkVerification()}>
                    {checkingVerification ? 'Checking ownership…' : 'Check domain ownership'}
                  </button>
                </>
              )}
            </div>

            <div className="wizard-actions"><button className="ghost-button" type="button" onClick={() => setStep(3)}>Back</button><button className="primary-button" type="button" disabled={!clientId.trim() || busy || !verification?.verified} onClick={() => void provision()}>{busy ? 'Deploying…' : verification?.verified ? 'Deploy website' : 'Verify domain first'}</button></div>
          </section>
        )}

        {step === 5 && (
          <section className="manager-card wizard-card deployment-card">
            <div className="section-head"><div><span className="step">5</span><div><strong>Deployment & domain</strong><small>GitHub → Netlify → DNS → SSL</small></div></div></div>
            {status && <div className="publish-status">{busy && <div className="spinner small-spinner" />}{status}</div>}
            {infrastructure?.netlify && <div className="alert success">Netlify aliases added for {infrastructure.domain}. Target: {infrastructure.netlify.hostname}</div>}
            {infrastructure?.dns_records && infrastructure.status !== 'domain_connected' && (
              <div className="dns-records">
                <h3>DNS records required</h3>
                <p>If the fixed-IP Namecheap provisioner is not connected, enter these at the DNS provider.</p>
                <code>@ {infrastructure.dns_records.apex.type} → {infrastructure.dns_records.apex.value}</code>
                <code>www {infrastructure.dns_records.www.type} → {infrastructure.dns_records.www.value}</code>
                <small>If the DNS provider does not support ALIAS at the apex, use A → {infrastructure.dns_records.apex_fallback.value}.</small>
              </div>
            )}
            <div className="wizard-actions"><button className="primary-button" type="button" onClick={() => void onComplete()}>Continue to site manager</button></div>
          </section>
        )}
      </main>
    </div>
  );
}
