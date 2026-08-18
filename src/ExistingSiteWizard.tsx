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
import { api, delay } from './api';
import type {
  BotsResponse,
  Domain,
  ManagerItem,
  NavigationFeature,
  PublishResponse,
  PublishStatusResponse,
  SiteSettingsResponse,
  ThemeColors,
} from './types';

const COLOR_FIELDS: Array<{ key: keyof ThemeColors; label: string; help: string }> = [
  { key: 'primary', label: 'Primary color', help: 'Active navigation item' },
  { key: 'secondary', label: 'Secondary color', help: 'Navigation icons and accents' },
  { key: 'nav_background', label: 'Navigation background', help: 'Main navigation bar' },
  { key: 'nav_text', label: 'Navigation text', help: 'Inactive navigation text' },
  { key: 'header_background', label: 'Header background', help: 'Top account/header area' },
];

const itemId = (item: ManagerItem) => item.kind === 'upload'
  ? `upload:${item.temp_id}`
  : `existing:${item.bot.id || item.bot.asset || item.bot.file}`;

const itemName = (item: ManagerItem) => item.kind === 'upload'
  ? item.name
  : item.bot.name || item.bot.title || item.bot.file.replace(/\.xml$/i, '');

const featureDndId = (id: string) => `feature:${id}`;

function SortableBot({ item, index, onDelete }: { item: ManagerItem; index: number; onDelete: () => void }) {
  const id = itemId(item);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.55 : 1 }} className={`bot-row ${isDragging ? 'is-dragging' : ''}`}>
      <button className="drag-handle" type="button" aria-label={`Move ${itemName(item)}`} {...attributes} {...listeners}><span>⋮⋮</span></button>
      <div className="bot-order">{index + 1}</div>
      <div className="bot-copy"><strong>{itemName(item)}</strong><small>{item.kind === 'upload' ? `${item.file_name} · NEW` : item.bot.file}</small></div>
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
      <button className="delete-button" type="button" disabled={feature.required} onClick={onDelete}>{feature.required ? 'Required' : 'Remove'}</button>
    </article>
  );
}

export default function ExistingSiteWizard({ site, onChangeDomain }: { site: Domain; onChangeDomain: () => Promise<void> }) {
  const [step, setStep] = useState(1);
  const [items, setItems] = useState<ManagerItem[]>([]);
  const [inheritedBots, setInheritedBots] = useState(false);
  const [botDirty, setBotDirty] = useState(false);
  const [catalog, setCatalog] = useState<NavigationFeature[]>([]);
  const [navigation, setNavigation] = useState<string[]>([]);
  const [colors, setColors] = useState<ThemeColors | null>(null);
  const [inheritedSettings, setInheritedSettings] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [featureToAdd, setFeatureToAdd] = useState('');
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  const anyDirty = botDirty || settingsDirty;
  const catalogById = useMemo(() => new Map(catalog.map(feature => [feature.id, feature])), [catalog]);
  const visibleFeatures = useMemo(
    () => navigation.map(id => catalogById.get(id)).filter((value): value is NavigationFeature => Boolean(value)),
    [catalogById, navigation]
  );
  const hiddenFeatures = useMemo(() => catalog.filter(feature => !navigation.includes(feature.id)), [catalog, navigation]);

  const loadBots = useCallback(async () => {
    const payload = await api<BotsResponse>(`bots?site_id=${encodeURIComponent(site.id)}`);
    setItems(payload.bots.map(bot => ({ kind: 'existing', bot })));
    setInheritedBots(payload.inherited);
    setBotDirty(false);
  }, [site.id]);

  const loadSettings = useCallback(async () => {
    const payload = await api<SiteSettingsResponse>(`site-settings?site_id=${encodeURIComponent(site.id)}`);
    setCatalog(payload.catalog);
    setNavigation(payload.navigation);
    setColors(payload.colors);
    setInheritedSettings(payload.inherited);
    setFeatureToAdd('');
    setSettingsDirty(false);
  }, [site.id]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([loadBots(), loadSettings()])
      .catch(err => alive && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [loadBots, loadSettings]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!anyDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);

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

  const onBotDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    setItems(current => {
      const from = current.findIndex(item => itemId(item) === event.active.id);
      const to = current.findIndex(item => itemId(item) === event.over?.id);
      return from < 0 || to < 0 ? current : arrayMove(current, from, to);
    });
    setBotDirty(true);
  };

  const onFeatureDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    setNavigation(current => {
      const from = current.findIndex(id => featureDndId(id) === event.active.id);
      const to = current.findIndex(id => featureDndId(id) === event.over?.id);
      return from < 0 || to < 0 ? current : arrayMove(current, from, to);
    });
    setSettingsDirty(true);
  };

  const waitForPublish = async (created: PublishResponse, label: string) => {
    if (created.status === 'no_changes') { setStatus(created.message || `${label}: no changes.`); return; }
    if (!created.pr) throw new Error(`${label} publish did not return a pull request number.`);
    setStatus(`${label}: PR #${created.pr} created. Waiting for Node 22/24 validation…`);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await delay(3000);
      const result = await api<PublishStatusResponse>(`publish-status?pr=${created.pr}`);
      setStatus(`${label}: ${result.message}`);
      if (result.status === 'merged') return;
      if (result.status === 'failed') throw new Error(result.message);
    }
    throw new Error(`${label} validation is still running.`);
  };

  const publishAll = async () => {
    if (publishing) return;
    if (!anyDirty) { setStatus('There are no unpublished changes for this website.'); setStep(5); return; }
    const publishSettings = settingsDirty;
    const publishBots = botDirty;
    setPublishing(true);
    setError('');
    setStep(5);
    try {
      if (publishSettings && colors) {
        const created = await api<PublishResponse>('publish-site', {
          method: 'POST',
          body: JSON.stringify({ site_id: site.id, navigation, colors }),
        });
        await waitForPublish(created, 'Navigation & theme');
        await loadSettings();
      }
      if (publishBots) {
        const created = await api<PublishResponse>('publish', {
          method: 'POST',
          body: JSON.stringify({ site_id: site.id, items }),
        });
        await waitForPublish(created, 'Bot library');
        await loadBots();
      }
      setStatus('All requested website changes passed validation and were merged. Netlify can now deploy the updated target main branch.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(false);
    }
  };

  const changeDomain = async () => {
    if (anyDirty && !window.confirm('Discard unpublished changes and change domain?')) return;
    await onChangeDomain();
  };

  if (loading || !colors) return <main className="loading-shell"><div className="spinner" />Loading website setup…</main>;

  const steps = ['Website', 'Navigation', 'Bots', 'Review', 'Publish'];

  return (
    <div className="app-shell onboarding-shell">
      <header className="topbar">
        <div className="topbar-brand"><div className="brand-mark small">SM</div><div><strong>Site Manager</strong><small>{site.display_domain}</small></div></div>
        <button className="ghost-button" type="button" onClick={() => void changeDomain()}>Change domain</button>
      </header>

      <main className="workspace onboarding-workspace">
        <section className="hero">
          <p className="eyebrow">EXISTING WEBSITE WIZARD</p>
          <h1>Manage {site.display_domain}</h1>
          <p>Move through the website setup step by step. Changes remain local until the final Publish step.</p>
        </section>

        <nav className="wizard-nav" aria-label="Website management steps">
          {steps.map((label, index) => <button key={label} type="button" className={step === index + 1 ? 'is-active' : ''} onClick={() => setStep(index + 1)}><span>{index + 1}</span>{label}</button>)}
        </nav>

        {anyDirty && <div className="alert info">You have unpublished changes. They will stay in this wizard until you publish or change domain.</div>}
        {error && <div className="alert error global-alert">{error}</div>}

        {step === 1 && (
          <section className="manager-card wizard-card">
            <div className="section-head"><div><span className="step">1</span><div><strong>Website configuration</strong><small>Current domain and Deriv application values</small></div></div></div>
            <div className="review-grid">
              <div><small>Domain</small><strong>{site.display_domain}</strong></div>
              <div><small>Site ID</small><strong>{site.id}</strong></div>
              <div><small>Website</small><strong>{site.website_url}</strong></div>
              <div><small>Redirect URI</small><strong>{site.redirect_uri || `${site.website_url}/callback`}</strong></div>
              <div><small>Deriv client / App ID</small><strong>{site.client_id || 'Not available'}</strong></div>
              <div><small>Environment</small><strong>{site.environment || 'production'}</strong></div>
              <div><small>OAuth scopes</small><strong>{site.scopes?.join(', ') || 'Not available'}</strong></div>
              <div><small>Legacy App ID</small><strong>{site.legacy_app_id || 'Not configured'}</strong></div>
            </div>
            <div className="wizard-actions"><a className="secondary-button link-button" href={site.website_url} target="_blank" rel="noreferrer">Open website ↗</a><button className="primary-button" type="button" onClick={() => setStep(2)}>Continue</button></div>
          </section>
        )}

        {step === 2 && (
          <section className="manager-card wizard-card">
            <div className="section-head"><div><span className="step">2</span><div><strong>Navigation & theme</strong><small>Drag sections, hide optional features, and customize colors</small></div></div><span className="count-pill">{navigation.length} VISIBLE</span></div>
            {inheritedSettings && <div className="alert info">This website is using template defaults. Publishing will create its own navigation and theme configuration.</div>}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onFeatureDragEnd}>
              <SortableContext items={navigation.map(featureDndId)} strategy={verticalListSortingStrategy}>
                <div className="bot-list feature-list">{visibleFeatures.map((feature, index) => <SortableFeature key={feature.id} feature={feature} index={index} onDelete={() => { if (!feature.required) { setNavigation(current => current.filter(id => id !== feature.id)); setSettingsDirty(true); } }} />)}</div>
              </SortableContext>
            </DndContext>
            <div className="add-feature-row"><select value={featureToAdd} onChange={event => setFeatureToAdd(event.target.value)} disabled={!hiddenFeatures.length}><option value="">{hiddenFeatures.length ? 'Select a hidden feature to add' : 'All available features are visible'}</option>{hiddenFeatures.map(feature => <option key={feature.id} value={feature.id}>{feature.label}</option>)}</select><button className="secondary-button" type="button" disabled={!featureToAdd} onClick={() => { if (featureToAdd && !navigation.includes(featureToAdd)) { setNavigation(current => [...current, featureToAdd]); setSettingsDirty(true); } setFeatureToAdd(''); }}>Add feature</button></div>
            <div className="theme-preview" style={{ background: colors.nav_background, color: colors.nav_text }}><span style={{ background: colors.primary, color: '#fff' }}>Active item</span><span style={{ color: colors.secondary }}>◆ Accent</span><span>Navigation text</span></div>
            <div className="color-grid">{COLOR_FIELDS.map(field => <label className="color-field" key={field.key}><div><strong>{field.label}</strong><small>{field.help}</small></div><div className="color-inputs"><input type="color" value={colors[field.key]} onChange={event => { setColors(current => current ? { ...current, [field.key]: event.target.value.toLowerCase() } : current); setSettingsDirty(true); }} /><input type="text" maxLength={7} value={colors[field.key]} onChange={event => { setColors(current => current ? { ...current, [field.key]: event.target.value.toLowerCase() } : current); setSettingsDirty(true); }} /></div></label>)}</div>
            <div className="wizard-actions"><button className="ghost-button" type="button" onClick={() => setStep(1)}>Back</button><button className="primary-button" type="button" onClick={() => setStep(3)}>Continue</button></div>
          </section>
        )}

        {step === 3 && (
          <section className="manager-card wizard-card">
            <div className="section-head"><div><span className="step">3</span><div><strong>Bot library</strong><small>Upload, remove and drag bots into display order</small></div></div><span className="count-pill">{items.length} BOT{items.length === 1 ? '' : 'S'}</span></div>
            {inheritedBots && <div className="alert info">This website is inheriting the shared bot library. Publishing will create its independent bot list.</div>}
            <label className="upload-zone"><input type="file" accept=".xml,text/xml,application/xml" multiple disabled={publishing} onChange={event => { if (event.target.files) void addFiles(event.target.files); event.target.value = ''; }} /><span className="upload-icon">＋</span><strong>Browse XML files</strong><small>Select one or several Blockly strategy files</small></label>
            {items.length ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onBotDragEnd}><SortableContext items={items.map(itemId)} strategy={verticalListSortingStrategy}><div className="bot-list">{items.map((item, index) => <SortableBot key={itemId(item)} item={item} index={index} onDelete={() => { setItems(current => current.filter(candidate => itemId(candidate) !== itemId(item))); setBotDirty(true); }} />)}</div></SortableContext></DndContext> : <div className="empty-state">No bots selected. Publishing this state will intentionally make this website's bot library empty.</div>}
            <div className="wizard-actions"><button className="ghost-button" type="button" onClick={() => setStep(2)}>Back</button><button className="primary-button" type="button" onClick={() => setStep(4)}>Review</button></div>
          </section>
        )}

        {step === 4 && (
          <section className="manager-card wizard-card">
            <div className="section-head"><div><span className="step">4</span><div><strong>Review changes</strong><small>Nothing is pushed until you confirm Publish</small></div></div></div>
            <div className="review-grid">
              <div><small>Website</small><strong>{site.display_domain}</strong></div>
              <div><small>Navigation</small><strong>{navigation.length} visible items</strong></div>
              <div><small>Bot library</small><strong>{items.length} bots</strong></div>
              <div><small>Navigation/theme changes</small><strong>{settingsDirty ? 'Ready to publish' : 'No changes'}</strong></div>
              <div><small>Bot changes</small><strong>{botDirty ? 'Ready to publish' : 'No changes'}</strong></div>
              <div><small>Deployment</small><strong>GitHub validation → main → Netlify</strong></div>
            </div>
            <div className="alert info">If both navigation/theme and bots changed, SITE-MANAGER publishes them sequentially so each update gets its own clear domain-specific GitHub history and validation.</div>
            <div className="wizard-actions"><button className="ghost-button" type="button" onClick={() => setStep(3)}>Back</button><button className="primary-button" type="button" onClick={() => setStep(5)}>Continue to Publish</button></div>
          </section>
        )}

        {step === 5 && (
          <section className="manager-card wizard-card deployment-card">
            <div className="section-head"><div><span className="step">5</span><div><strong>Publish website updates</strong><small>Branch → PR → Node 22/24 → merge → Netlify</small></div></div></div>
            <div className="review-grid"><div><small>Navigation/theme</small><strong>{settingsDirty ? 'Will publish' : 'Unchanged'}</strong></div><div><small>Bots</small><strong>{botDirty ? 'Will publish' : 'Unchanged'}</strong></div></div>
            {status && <div className="publish-status">{publishing && <div className="spinner small-spinner" />}{status}</div>}
            <div className="wizard-actions"><button className="ghost-button" type="button" disabled={publishing} onClick={() => setStep(4)}>Back</button><button className="primary-button" type="button" disabled={publishing || !anyDirty} onClick={() => void publishAll()}>{publishing ? 'Publishing…' : anyDirty ? 'Publish website updates' : 'No changes to publish'}</button></div>
          </section>
        )}
      </main>
    </div>
  );
}
