import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ApiError, api, delay } from './api';
import ProvisioningWizard from './ProvisioningWizard';
import type {
  BotsResponse,
  Domain,
  DomainsResponse,
  LoginResponse,
  ManagerItem,
  NavigationFeature,
  PublishResponse,
  PublishStatusResponse,
  SiteSettingsResponse,
  ThemeColors,
} from './types';
import './onboarding.css';

type ManagerMode = 'bots' | 'site';

const itemId = (item: ManagerItem) => item.kind === 'upload'
  ? `upload:${item.temp_id}`
  : `existing:${item.bot.id || item.bot.asset || item.bot.file}`;
const visibleName = (item: ManagerItem) => item.kind === 'upload'
  ? item.name
  : item.bot.name || item.bot.title || item.bot.file.replace(/\.xml$/i, '');
const featureDndId = (id: string) => `feature:${id}`;

const COLOR_FIELDS: Array<{ key: keyof ThemeColors; label: string; help: string }> = [
  { key: 'primary', label: 'Primary color', help: 'Active navigation item' },
  { key: 'secondary', label: 'Secondary color', help: 'Navigation icons/accent' },
  { key: 'nav_background', label: 'Navigation background', help: 'Main navigation bar' },
  { key: 'nav_text', label: 'Navigation text', help: 'Inactive navigation text' },
  { key: 'header_background', label: 'Header background', help: 'Top account/header area' },
];

function SortableBot({ item, index, onDelete }: { item: ManagerItem; index: number; onDelete: () => void }) {
  const id = itemId(item);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.55 : 1 }} className={`bot-row ${isDragging ? 'is-dragging' : ''}`}>
      <button className="drag-handle" type="button" aria-label={`Move ${visibleName(item)}`} {...attributes} {...listeners}><span>⋮⋮</span></button>
      <div className="bot-order">{index + 1}</div>
      <div className="bot-copy"><strong>{visibleName(item)}</strong><small>{item.kind === 'upload' ? `${item.file_name} · NEW` : item.bot.file}</small></div>
      <span className={`source-pill ${item.kind === 'upload' ? 'new' : ''}`}>{item.kind === 'upload' ? 'NEW' : 'LIVE'}</span>
      <button className="delete-button" type="button" onClick={onDelete}>Delete</button>
    </article>
  );
}

function SortableFeature({ feature, index, onDelete }: { feature: NavigationFeature; index: number; onDelete: () => void }) {
  const id = featureDndId(feature.id);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.55 : 1 }} className={`bot-row feature-row ${isDragging ? 'is-dragging' : ''}`}>
      <button className="drag-handle" type="button" aria-label={`Move ${feature.label}`} {...attributes} {...listeners}><span>⋮⋮</span></button>
      <div className="bot-order">{index + 1}</div>
      <div className="bot-copy"><strong>{feature.label}</strong><small>{feature.id}</small></div>
      <span className={`source-pill ${feature.required ? 'required' : ''}`}>{feature.required ? 'REQUIRED' : 'VISIBLE'}</span>
      <button className="delete-button" type="button" onClick={onDelete} disabled={feature.required}>{feature.required ? 'Required' : 'Remove'}</button>
    </article>
  );
}

function Login({ onSuccess }: { onSuccess: (result: LoginResponse) => Promise<void> }) {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<LoginResponse>('login', { method: 'POST', body: JSON.stringify({ domain }) });
      setDomain('');
      await onSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-shell private-login-shell">
      <section className="login-card private-login-card">
        <div className="brand-mark">SM</div>
        <p className="eyebrow">SITE ACCESS</p>
        <h1>Site Manager</h1>
        <p className="muted">Enter your domain to continue.</p>
        <form onSubmit={submit}>
          <label>Domain<input type="text" value={domain} autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={event => setDomain(event.target.value.toLowerCase())} required /></label>
          {error && <div className="alert error">{error}</div>}
          <button className="primary-button" disabled={busy || !domain.trim()} type="submit">{busy ? 'Opening…' : 'Continue'}</button>
        </form>
      </section>
    </main>
  );
}

export default function AppV2() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [mode, setMode] = useState<ManagerMode>('bots');

  const [items, setItems] = useState<ManagerItem[]>([]);
  const [inherited, setInherited] = useState(false);
  const [loadingBots, setLoadingBots] = useState(false);
  const [botDirty, setBotDirty] = useState(false);

  const [catalog, setCatalog] = useState<NavigationFeature[]>([]);
  const [navigation, setNavigation] = useState<string[]>([]);
  const [colors, setColors] = useState<ThemeColors | null>(null);
  const [settingsInherited, setSettingsInherited] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [featureToAdd, setFeatureToAdd] = useState('');

  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  const selectedDomain = useMemo(() => domains.find(domain => domain.id === selectedSite), [domains, selectedSite]);
  const currentDirty = mode === 'bots' ? botDirty : settingsDirty;
  const anyDirty = botDirty || settingsDirty;
  const catalogById = useMemo(() => new Map(catalog.map(feature => [feature.id, feature])), [catalog]);
  const visibleFeatures = useMemo(() => navigation.map(id => catalogById.get(id)).filter((feature): feature is NavigationFeature => Boolean(feature)), [catalogById, navigation]);
  const hiddenFeatures = useMemo(() => catalog.filter(feature => !navigation.includes(feature.id)), [catalog, navigation]);

  const loadDomains = useCallback(async () => {
    try {
      const payload = await api<DomainsResponse>('domains');
      const domain = payload.domains[0];
      setDomains(domain ? [domain] : []);
      setSelectedSite(domain?.id || '');
      setOnboarding(Boolean(payload.onboarding));
      setAuthenticated(true);
      setError('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthenticated(false);
        setOnboarding(false);
        setDomains([]);
        setSelectedSite('');
        return;
      }
      setAuthenticated(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleLogin = async (_result: LoginResponse) => {
    await loadDomains();
  };

  const loadBots = useCallback(async (siteId: string) => {
    if (!siteId) return;
    setLoadingBots(true);
    setError('');
    setPublishMessage('');
    try {
      const payload = await api<BotsResponse>(`bots?site_id=${encodeURIComponent(siteId)}`);
      setItems(payload.bots.map(bot => ({ kind: 'existing', bot })));
      setInherited(payload.inherited);
      setBotDirty(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setAuthenticated(false);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingBots(false);
    }
  }, []);

  const loadSettings = useCallback(async (siteId: string) => {
    if (!siteId) return;
    setSettingsLoading(true);
    setError('');
    setPublishMessage('');
    try {
      const payload = await api<SiteSettingsResponse>(`site-settings?site_id=${encodeURIComponent(siteId)}`);
      setCatalog(payload.catalog);
      setNavigation(payload.navigation);
      setColors(payload.colors);
      setSettingsInherited(payload.inherited);
      setSettingsDirty(false);
      setFeatureToAdd('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setAuthenticated(false);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => { void loadDomains(); }, [loadDomains]);
  useEffect(() => {
    if (!authenticated || onboarding || !selectedSite) return;
    if (mode === 'bots') void loadBots(selectedSite);
    else void loadSettings(selectedSite);
  }, [authenticated, onboarding, selectedSite, mode, loadBots, loadSettings]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!anyDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);

  const onBotDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems(current => {
      const oldIndex = current.findIndex(item => itemId(item) === active.id);
      const newIndex = current.findIndex(item => itemId(item) === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      return arrayMove(current, oldIndex, newIndex);
    });
    setBotDirty(true);
  };

  const onFeatureDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setNavigation(current => {
      const oldIndex = current.findIndex(id => featureDndId(id) === active.id);
      const newIndex = current.findIndex(id => featureDndId(id) === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      return arrayMove(current, oldIndex, newIndex);
    });
    setSettingsDirty(true);
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
    if (next.length) { setItems(current => [...current, ...next]); setBotDirty(true); }
    setError(problems.join(' '));
  };

  const waitForPublish = async (created: PublishResponse, afterMerge: () => Promise<void>) => {
    if (created.status === 'no_changes') { setPublishMessage(created.message || 'Nothing changed.'); return; }
    if (!created.pr) throw new Error('Publish did not return a pull request number.');
    setPublishMessage(`PR #${created.pr} created. Waiting for Node 22/24 validation…`);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await delay(3000);
      const status = await api<PublishStatusResponse>(`publish-status?pr=${created.pr}`);
      setPublishMessage(status.message);
      if (status.status === 'merged') { await afterMerge(); return; }
      if (status.status === 'failed') throw new Error(status.message);
    }
    throw new Error('Validation is still running. Refresh only after checking the open GitHub PR.');
  };

  const publishBots = async () => {
    if (!selectedSite) return;
    const created = await api<PublishResponse>('publish', { method: 'POST', body: JSON.stringify({ site_id: selectedSite, items }) });
    await waitForPublish(created, async () => { setBotDirty(false); await loadBots(selectedSite); });
    if (created.status === 'no_changes') setBotDirty(false);
  };

  const publishSite = async () => {
    if (!selectedSite || !colors) return;
    const created = await api<PublishResponse>('publish-site', { method: 'POST', body: JSON.stringify({ site_id: selectedSite, navigation, colors }) });
    await waitForPublish(created, async () => { setSettingsDirty(false); await loadSettings(selectedSite); });
    if (created.status === 'no_changes') setSettingsDirty(false);
  };

  const publish = async () => {
    if (!selectedSite || publishing) return;
    setPublishing(true);
    setError('');
    setPublishMessage('Creating validation pull request…');
    try { if (mode === 'bots') await publishBots(); else await publishSite(); }
    catch (err) { if (err instanceof ApiError && err.status === 401) setAuthenticated(false); else setError(err instanceof Error ? err.message : String(err)); }
    finally { setPublishing(false); }
  };

  const changeMode = (next: ManagerMode) => {
    if (next === mode) return;
    if (currentDirty && !window.confirm('Discard unpublished changes in the current editor?')) return;
    if (mode === 'bots') setBotDirty(false); else setSettingsDirty(false);
    setError(''); setPublishMessage(''); setMode(next);
  };

  const logout = async () => {
    if (anyDirty && !window.confirm('Discard unpublished changes and change domain?')) return;
    try { await api('logout', { method: 'POST' }); }
    finally {
      setAuthenticated(false); setOnboarding(false); setDomains([]); setItems([]); setCatalog([]); setNavigation([]); setColors(null); setSelectedSite(''); setBotDirty(false); setSettingsDirty(false); setError(''); setPublishMessage('');
    }
  };

  if (authenticated === null) return <main className="loading-shell"><div className="spinner" />Checking domain session…</main>;
  if (!authenticated) return <Login onSuccess={handleLogin} />;
  if (onboarding && selectedDomain) return <ProvisioningWizard site={selectedDomain} onComplete={loadDomains} onChangeDomain={logout} />;

  const busy = publishing || loadingBots || settingsLoading;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand"><div className="brand-mark small">SM</div><div><strong>Site Manager</strong><small>{selectedDomain?.display_domain || 'Domain access'}</small></div></div>
        <button className="ghost-button" type="button" onClick={() => void logout()}>Change domain</button>
      </header>

      <main className="workspace">
        <section className="hero"><p className="eyebrow">DOMAIN SITE CONTROL</p><h1>{selectedDomain ? `Manage ${selectedDomain.display_domain}` : 'Manage domain'}</h1><p>This session is locked to the domain entered at access. Choose what to update, make changes, then publish through GitHub validation.</p></section>

        <section className="manager-card">
          <div className="section-head"><div><span className="step">1</span><div><strong>Authorized domain</strong><small>Only this domain is visible in the current session</small></div></div>{currentDirty && <span className="unsaved-pill">UNPUBLISHED CHANGES</span>}</div>
          {selectedDomain && <div className="domain-meta domain-meta--locked"><div><strong>{selectedDomain.display_domain}</strong><span>{selectedDomain.id}</span></div><a href={selectedDomain.website_url} target="_blank" rel="noreferrer">Open site ↗</a></div>}
        </section>

        <section className="manager-card">
          <div className="section-head"><div><span className="step">2</span><div><strong>What do you want to update?</strong><small>Choose one editor at a time</small></div></div></div>
          <select className="domain-select mode-select" value={mode} disabled={publishing} onChange={event => changeMode(event.target.value as ManagerMode)}><option value="bots">Bot Library — add, remove and reorder XML bots</option><option value="site">Navigation & Theme — customize sections, order and colors</option></select>
        </section>

        {error && <div className="alert error global-alert">{error}</div>}

        {mode === 'bots' ? (
          <section className="manager-card">
            <div className="section-head"><div><span className="step">3</span><div><strong>Manage bots</strong><small>Drag to set first-to-last display order</small></div></div><span className="count-pill">{items.length} BOT{items.length === 1 ? '' : 'S'}</span></div>
            {inherited && !loadingBots && <div className="alert info">This domain is currently inheriting the shared bot library. Its first Publish will create an independent domain bot list.</div>}
            <label className="upload-zone"><input type="file" accept=".xml,text/xml,application/xml" multiple disabled={publishing} onChange={event => { if (event.target.files) void addFiles(event.target.files); event.target.value = ''; }} /><span className="upload-icon">＋</span><strong>Browse XML files</strong><small>Select one or several Blockly bot XML files</small></label>
            <div className="bot-list-wrap">{loadingBots ? <div className="empty-state"><div className="spinner" />Loading published bots…</div> : items.length === 0 ? <div className="empty-state">No bots selected for this domain. Publishing this state will intentionally make its bot library empty.</div> : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onBotDragEnd}><SortableContext items={items.map(itemId)} strategy={verticalListSortingStrategy}><div className="bot-list">{items.map((item, index) => <SortableBot key={itemId(item)} item={item} index={index} onDelete={() => { setItems(current => current.filter(candidate => itemId(candidate) !== itemId(item))); setBotDirty(true); }} />)}</div></SortableContext></DndContext>}</div>
          </section>
        ) : (
          <section className="manager-card">
            <div className="section-head"><div><span className="step">3</span><div><strong>Navigation & theme</strong><small>Only features already available in the template can be added</small></div></div><span className="count-pill">{navigation.length} VISIBLE</span></div>
            {settingsInherited && !settingsLoading && <div className="alert info">This domain is using the template defaults. The first Publish will create its own navigation and color configuration.</div>}
            {settingsLoading || !colors ? <div className="empty-state"><div className="spinner" />Loading site configuration…</div> : <>
              <div className="settings-subhead"><div><strong>Navigation items</strong><small>Drag to reorder. Remove optional items you do not want.</small></div></div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onFeatureDragEnd}><SortableContext items={navigation.map(featureDndId)} strategy={verticalListSortingStrategy}><div className="bot-list feature-list">{visibleFeatures.map((feature, index) => <SortableFeature key={feature.id} feature={feature} index={index} onDelete={() => { if (feature.required) return; setNavigation(current => current.filter(id => id !== feature.id)); setSettingsDirty(true); }} />)}</div></SortableContext></DndContext>
              <div className="add-feature-row"><select value={featureToAdd} onChange={event => setFeatureToAdd(event.target.value)} disabled={!hiddenFeatures.length}><option value="">{hiddenFeatures.length ? 'Select a hidden feature to add' : 'All available features are visible'}</option>{hiddenFeatures.map(feature => <option key={feature.id} value={feature.id}>{feature.label}</option>)}</select><button type="button" className="secondary-button" disabled={!featureToAdd} onClick={() => { if (!featureToAdd || navigation.includes(featureToAdd)) return; setNavigation(current => [...current, featureToAdd]); setFeatureToAdd(''); setSettingsDirty(true); }}>Add feature</button></div>
              <div className="settings-subhead theme-subhead"><div><strong>Navigation colors</strong><small>Current colors are shown below. Pick a color or enter a six-digit hex value.</small></div></div>
              <div className="theme-preview" style={{ background: colors.nav_background, color: colors.nav_text }}><span style={{ background: colors.primary, color: '#fff' }}>Active item</span><span style={{ color: colors.secondary }}>◆ Icon accent</span><span>Navigation text</span></div>
              <div className="color-grid">{COLOR_FIELDS.map(field => <label className="color-field" key={field.key}><div><strong>{field.label}</strong><small>{field.help}</small></div><div className="color-inputs"><input type="color" value={colors[field.key]} onChange={event => { setColors(current => current ? { ...current, [field.key]: event.target.value.toLowerCase() } : current); setSettingsDirty(true); }} /><input type="text" value={colors[field.key]} maxLength={7} spellCheck={false} onChange={event => { setColors(current => current ? { ...current, [field.key]: event.target.value.toLowerCase() } : current); setSettingsDirty(true); }} /></div></label>)}</div>
            </>}
          </section>
        )}

        <section className="publish-card"><div><span className="step">4</span><div><strong>Publish {mode === 'bots' ? 'bot library' : 'navigation & theme'}</strong><small>Branch → PR → Node 22/24 checks → merge → Netlify</small></div></div><button className="primary-button publish-button" type="button" disabled={!selectedSite || busy} onClick={() => void publish()}>{publishing ? 'Publishing…' : 'Publish'}</button></section>
        {publishMessage && <div className="publish-status">{publishing && <div className="spinner small-spinner" />}{publishMessage}</div>}
      </main>
    </div>
  );
}
