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
import type {
  BotsResponse,
  Domain,
  ManagerItem,
  PublishResponse,
  PublishStatusResponse,
} from './types';

const itemId = (item: ManagerItem) =>
  item.kind === 'upload'
    ? `upload:${item.temp_id}`
    : `existing:${item.bot.id || item.bot.asset || item.bot.file}`;

const visibleName = (item: ManagerItem) =>
  item.kind === 'upload'
    ? item.name
    : item.bot.name || item.bot.title || item.bot.file.replace(/\.xml$/i, '');

function SortableBot({ item, index, onDelete }: { item: ManagerItem; index: number; onDelete: () => void }) {
  const id = itemId(item);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  };

  return (
    <article ref={setNodeRef} style={style} className={`bot-row ${isDragging ? 'is-dragging' : ''}`}>
      <button className="drag-handle" type="button" aria-label={`Move ${visibleName(item)}`} {...attributes} {...listeners}>
        <span>⋮⋮</span>
      </button>
      <div className="bot-order">{index + 1}</div>
      <div className="bot-copy">
        <strong>{visibleName(item)}</strong>
        <small>{item.kind === 'upload' ? `${item.file_name} · NEW` : item.bot.file}</small>
      </div>
      <span className={`source-pill ${item.kind === 'upload' ? 'new' : ''}`}>
        {item.kind === 'upload' ? 'NEW' : 'LIVE'}
      </span>
      <button className="delete-button" type="button" onClick={onDelete} aria-label={`Delete ${visibleName(item)}`}>
        Delete
      </button>
    </article>
  );
}

function Login({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('login', { method: 'POST', body: JSON.stringify({ password }) });
      setPassword('');
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">SM</div>
        <p className="eyebrow">DERIV SITE OPERATIONS</p>
        <h1>Site Bot Manager</h1>
        <p className="muted">Manage the bot library for each configured domain without exposing GitHub credentials in the browser.</p>
        <form onSubmit={submit}>
          <label>
            Manager password
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={event => setPassword(event.target.value)}
              placeholder="Enter manager password"
              required
            />
          </label>
          {error && <div className="alert error">{error}</div>}
          <button className="primary-button" disabled={busy || !password} type="submit">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [items, setItems] = useState<ManagerItem[]>([]);
  const [inherited, setInherited] = useState(false);
  const [loadingBots, setLoadingBots] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  const selectedDomain = useMemo(
    () => domains.find(domain => domain.id === selectedSite),
    [domains, selectedSite]
  );

  const loadDomains = useCallback(async () => {
    try {
      const payload = await api<{ domains: Domain[] }>('domains');
      setDomains(payload.domains);
      setAuthenticated(true);
      setError('');
      if (!selectedSite && payload.domains[0]) setSelectedSite(payload.domains[0].id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthenticated(false);
        return;
      }
      setAuthenticated(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedSite]);

  const loadBots = useCallback(async (siteId: string) => {
    if (!siteId) return;
    setLoadingBots(true);
    setError('');
    setPublishMessage('');
    try {
      const payload = await api<BotsResponse>(`bots?site_id=${encodeURIComponent(siteId)}`);
      setItems(payload.bots.map(bot => ({ kind: 'existing', bot })));
      setInherited(payload.inherited);
      setDirty(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setAuthenticated(false);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingBots(false);
    }
  }, []);

  useEffect(() => {
    void loadDomains();
  }, [loadDomains]);

  useEffect(() => {
    if (authenticated && selectedSite) void loadBots(selectedSite);
  }, [authenticated, selectedSite, loadBots]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems(current => {
      const oldIndex = current.findIndex(item => itemId(item) === active.id);
      const newIndex = current.findIndex(item => itemId(item) === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      return arrayMove(current, oldIndex, newIndex);
    });
    setDirty(true);
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

    if (next.length) {
      setItems(current => [...current, ...next]);
      setDirty(true);
    }
    setError(problems.join(' '));
  };

  const publish = async () => {
    if (!selectedSite || publishing) return;
    setPublishing(true);
    setError('');
    setPublishMessage('Creating validation pull request…');

    try {
      const created = await api<PublishResponse>('publish', {
        method: 'POST',
        body: JSON.stringify({ site_id: selectedSite, items }),
      });

      if (created.status === 'no_changes') {
        setPublishMessage(created.message || 'Nothing changed.');
        setDirty(false);
        return;
      }

      if (!created.pr) throw new Error('Publish did not return a pull request number.');
      setPublishMessage(`PR #${created.pr} created. Waiting for Node 22/24 validation…`);

      for (let attempt = 0; attempt < 120; attempt += 1) {
        await delay(3000);
        const status = await api<PublishStatusResponse>(`publish-status?pr=${created.pr}`);
        setPublishMessage(status.message);

        if (status.status === 'merged') {
          setDirty(false);
          await loadBots(selectedSite);
          return;
        }
        if (status.status === 'failed') throw new Error(status.message);
      }
      throw new Error('Validation is still running. Refresh and publish again only after checking the open GitHub PR.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setAuthenticated(false);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(false);
    }
  };

  const logout = async () => {
    try {
      await api('logout', { method: 'POST' });
    } finally {
      setAuthenticated(false);
      setDomains([]);
      setItems([]);
      setSelectedSite('');
    }
  };

  if (authenticated === null) {
    return <main className="loading-shell"><div className="spinner" />Checking manager session…</main>;
  }

  if (!authenticated) return <Login onSuccess={loadDomains} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="brand-mark small">SM</div>
          <div><strong>Site Bot Manager</strong><small>DukeNyamasege/nnn</small></div>
        </div>
        <button className="ghost-button" type="button" onClick={logout}>Sign out</button>
      </header>

      <main className="workspace">
        <section className="hero">
          <p className="eyebrow">DOMAIN BOT CONTROL</p>
          <h1>Publish the right bots to the right site.</h1>
          <p>Select a managed domain, add or remove XML strategies, drag them into order, then publish. GitHub validation must pass before the target repository is merged.</p>
        </section>

        <section className="manager-card">
          <div className="section-head">
            <div>
              <span className="step">1</span>
              <div><strong>Select domain</strong><small>Loaded live from the target repository</small></div>
            </div>
            {dirty && <span className="unsaved-pill">UNPUBLISHED CHANGES</span>}
          </div>

          <select
            className="domain-select"
            value={selectedSite}
            disabled={publishing}
            onChange={event => {
              if (dirty && !window.confirm('Discard unpublished changes and switch domain?')) return;
              setSelectedSite(event.target.value);
            }}
          >
            {domains.map(domain => <option key={domain.id} value={domain.id}>{domain.display_domain}</option>)}
          </select>

          {selectedDomain && (
            <div className="domain-meta">
              <span>{selectedDomain.id}</span>
              <a href={selectedDomain.website_url} target="_blank" rel="noreferrer">Open site ↗</a>
            </div>
          )}
        </section>

        <section className="manager-card">
          <div className="section-head">
            <div>
              <span className="step">2</span>
              <div><strong>Manage bots</strong><small>Drag to set first-to-last display order</small></div>
            </div>
            <span className="count-pill">{items.length} BOT{items.length === 1 ? '' : 'S'}</span>
          </div>

          {inherited && !loadingBots && (
            <div className="alert info">This domain is currently inheriting the shared bot library. Its first Publish will create an independent domain bot list.</div>
          )}
          {error && <div className="alert error">{error}</div>}

          <label className="upload-zone">
            <input
              type="file"
              accept=".xml,text/xml,application/xml"
              multiple
              disabled={publishing}
              onChange={event => {
                if (event.target.files) void addFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <span className="upload-icon">＋</span>
            <strong>Browse XML files</strong>
            <small>Select one or several Blockly bot XML files</small>
          </label>

          <div className="bot-list-wrap">
            {loadingBots ? (
              <div className="empty-state"><div className="spinner" />Loading published bots…</div>
            ) : items.length === 0 ? (
              <div className="empty-state">No bots selected for this domain. Publishing this state will intentionally make its bot library empty.</div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={items.map(itemId)} strategy={verticalListSortingStrategy}>
                  <div className="bot-list">
                    {items.map((item, index) => (
                      <SortableBot
                        key={itemId(item)}
                        item={item}
                        index={index}
                        onDelete={() => {
                          setItems(current => current.filter(candidate => itemId(candidate) !== itemId(item)));
                          setDirty(true);
                        }}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </section>

        <section className="publish-card">
          <div>
            <span className="step">3</span>
            <div><strong>Publish to GitHub</strong><small>Branch → PR → Node 22/24 checks → merge → Netlify</small></div>
          </div>
          <button className="primary-button publish-button" type="button" disabled={!selectedSite || publishing || loadingBots} onClick={publish}>
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
        </section>

        {publishMessage && <div className="publish-status">{publishing && <div className="spinner small-spinner" />}{publishMessage}</div>}
      </main>
    </div>
  );
}
