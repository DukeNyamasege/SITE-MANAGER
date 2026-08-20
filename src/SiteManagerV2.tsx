import { useState } from 'react';
import AppV2 from './AppV2';
import { AuthProvider, AuthScreen, useAuth } from './auth';
import { WebsiteBuilderView } from './builder';
import { DeploymentsWorkspace } from './deployments';
import { DomainsWorkspace } from './domains';
import { LegacyMigrationWorkspace } from './legacy-migration';
import { CutoverReadinessWorkspace } from './parity';
import { RuntimePreviewView } from './runtime-preview';
import { CreateWebsiteView, MyWebsitesView, type WebsiteRecord } from './websites';
import './styles.css';
import './customization.css';
import './netlify-only.css';
import './v2.css';

type WorkspaceView = 'overview' | 'my-websites' | 'create-website' | 'builder' | 'runtime-preview' | 'domains' | 'deployments' | 'legacy-migration' | 'cutover-readiness' | 'current-manager' | 'account';

const capabilities = [
  'Verified customer accounts and VPS sessions',
  'One customer can own multiple websites',
  'Five-step per-website nnn configuration builder',
  'Live Site Manager → nnn runtime configuration channel',
  'Private real-template previews with trading disabled',
  'Custom domains and Site Manager platform addresses',
  'DNS ownership, VPS routing and HTTPS eligibility checks',
  'Versioned shared-nnn VPS publishing engine',
  'Immutable Site Manager and nnn release directories with rollback',
  'Dedicated private preview hostname on the shared nnn runtime',
  'Hardened systemd, Caddy and daily backup package',
  'Automated Site Manager ↔ held nnn staging rehearsal on Node 22/24',
  'Legacy HTML runtime fallback regression gate',
  'Audited and idempotent existing-nnn migration inventory',
  'Admin-only legacy ownership assignment with drift detection',
  'Live/V2 database parity recomputed on every readiness read',
  'Stable-live versus held-runtime registry, customization and bot-asset parity',
  'Preview approval automatically invalidated by configuration changes',
  'Fail-closed per-site cutover readiness with stale-evidence detection',
  'nnn production main isolated until explicit final cutover',
  'Payment lifecycle intentionally deferred',
];

export default function SiteManagerV2() {
  return <AuthProvider><AuthenticatedWorkspace /></AuthProvider>;
}

function AuthenticatedWorkspace() {
  const { user, loading, logout } = useAuth();
  const [view, setView] = useState<WorkspaceView>('overview');
  const [builderWebsiteId, setBuilderWebsiteId] = useState('');
  const [previewWebsiteId, setPreviewWebsiteId] = useState('');
  const [domainWebsiteId, setDomainWebsiteId] = useState('');

  if (loading) return <main className="auth-loading">Checking your Site Manager account…</main>;
  if (!user) return <AuthScreen />;

  if (view === 'current-manager') {
    return <div className="v2-legacy-shell"><div className="v2-development-bar"><div><strong>Site Manager V2</strong><span>Development workspace · current domain manager preserved during migration</span></div><button type="button" onClick={() => setView('overview')}>Back to V2 overview</button></div><AppV2 /></div>;
  }

  const openBuilder = (website: WebsiteRecord) => { setBuilderWebsiteId(website.id); setView('builder'); };
  const openPreview = (website: WebsiteRecord) => { setPreviewWebsiteId(website.id); setView('runtime-preview'); };
  const openDomains = (website: WebsiteRecord) => { setDomainWebsiteId(website.id); setView('domains'); };
  const editPreviewedWebsite = () => { if (previewWebsiteId) { setBuilderWebsiteId(previewWebsiteId); setView('builder'); } };

  const pageTitle = view === 'account' ? 'Your account'
    : view === 'my-websites' ? 'My Websites'
      : view === 'create-website' ? 'Create Website'
        : view === 'builder' ? 'Website Builder'
          : view === 'runtime-preview' ? 'Preview & Assets'
            : view === 'domains' ? 'Domains'
              : view === 'deployments' ? 'Deployments'
                : view === 'legacy-migration' ? 'Legacy nnn Migration'
                  : view === 'cutover-readiness' ? 'Cutover Readiness'
                    : 'Site Manager V2';

  const websitesActive = ['my-websites', 'builder', 'runtime-preview'].includes(view);

  return <div className="v2-shell">
    <aside className="v2-sidebar">
      <div className="v2-brand"><div className="v2-brand-mark">SM</div><div><strong>Site Manager</strong><small>V2 Development</small></div></div>
      <nav className="v2-nav" aria-label="Site Manager V2 development navigation">
        <button className={view === 'overview' ? 'is-active' : ''} type="button" onClick={() => setView('overview')}>Overview</button>
        <button className={websitesActive ? 'is-active' : ''} type="button" onClick={() => setView('my-websites')}>My Websites</button>
        <button className={view === 'create-website' ? 'is-active' : ''} type="button" onClick={() => setView('create-website')}>Create Website</button>
        <button type="button" disabled>Templates</button>
        <button className={view === 'domains' ? 'is-active' : ''} type="button" onClick={() => setView('domains')}>Domains</button>
        <button className={view === 'deployments' ? 'is-active' : ''} type="button" onClick={() => setView('deployments')}>Deployments</button>
        <button className={view === 'legacy-migration' ? 'is-active' : ''} type="button" onClick={() => setView('legacy-migration')}>Legacy Migration</button>
        <button className={view === 'cutover-readiness' ? 'is-active' : ''} type="button" onClick={() => setView('cutover-readiness')}>Cutover Readiness</button>
        <button className={view === 'account' ? 'is-active' : ''} type="button" onClick={() => setView('account')}>Account</button>
      </nav>
      <div className="v2-sidebar-footer"><span className="v2-status-dot" />Netlify deployment paused</div>
    </aside>

    <main className="v2-main">
      <header className="v2-topbar"><div><p>DEVELOPMENT WORKSPACE</p><h1>{pageTitle}</h1></div><div className="v2-account-chip"><div><strong>{user.display_name || 'Site Manager customer'}</strong><small>{user.email}</small></div><button type="button" onClick={() => void logout()}>Sign out</button></div></header>
      {view === 'account' && <AccountView />}
      {view === 'overview' && <OverviewView onOpenCurrentManager={() => setView('current-manager')} onCreateWebsite={() => setView('create-website')} onOpenDomains={() => setView('domains')} onOpenDeployments={() => setView('deployments')} onOpenMigration={() => setView('legacy-migration')} onOpenParity={() => setView('cutover-readiness')} />}
      {view === 'my-websites' && <MyWebsitesView onCreateWebsite={() => setView('create-website')} onContinueSetup={openBuilder} onPreviewWebsite={openPreview} onManageDomains={openDomains} />}
      {view === 'create-website' && <CreateWebsiteView onCreated={openBuilder} onCancel={() => setView('my-websites')} />}
      {view === 'builder' && builderWebsiteId && <WebsiteBuilderView websiteId={builderWebsiteId} onBack={() => setView('my-websites')} onCompleted={() => setView('my-websites')} />}
      {view === 'runtime-preview' && previewWebsiteId && <RuntimePreviewView websiteId={previewWebsiteId} onBack={() => setView('my-websites')} onEditSetup={editPreviewedWebsite} />}
      {view === 'domains' && <DomainsWorkspace initialWebsiteId={domainWebsiteId} focus="domains" />}
      {view === 'deployments' && <DeploymentsWorkspace initialWebsiteId={domainWebsiteId} />}
      {view === 'legacy-migration' && <LegacyMigrationWorkspace />}
      {view === 'cutover-readiness' && <CutoverReadinessWorkspace />}
    </main>
  </div>;
}

function AccountView() {
  const { user } = useAuth();
  if (!user) return null;
  return <>
    <section className="v2-hero-card"><div><p className="v2-kicker">STEP 11 · DUAL-RUN PARITY</p><h2>Migrated sites now have a fail-closed readiness gate before production cutover.</h2><p>Site Manager compares the current V2 shadow with the latest audited live nnn source and held integration runtime. Configuration edits invalidate preview approval, source drift invalidates runtime evidence, and any mismatch blocks cutover readiness.</p></div></section>
    <section className="v2-grid">
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">EMAIL</span><h3>{user.email}</h3></div><span className="v2-state good">VERIFIED</span></div><p>Email verification protects the customer control plane.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">PARITY</span><h3>Fail closed</h3></div><span className="v2-state good">EVIDENCE</span></div><p>A site is ready only when every live/V2/runtime check passes against current fingerprints.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">PAYMENT</span><h3>Designed later</h3></div><span className="v2-state">DEFERRED</span></div><p>No checkout, trial clock or payment gate participates in parity or cutover readiness.</p></article>
    </section>
    <section className="v2-next-step"><div><p>NEXT MILESTONE</p><h2>Controlled cutover orchestration and rollback window</h2><span>Step 12 will consume only parity-ready sites, create an explicit operator-approved cutover plan, preserve the old production route for rollback, and still require a separate final action before customer traffic moves.</span></div><div className="v2-step-number">12</div></section>
  </>;
}

function OverviewView({ onOpenCurrentManager, onCreateWebsite, onOpenDomains, onOpenDeployments, onOpenMigration, onOpenParity }: { onOpenCurrentManager: () => void; onCreateWebsite: () => void; onOpenDomains: () => void; onOpenDeployments: () => void; onOpenMigration: () => void; onOpenParity: () => void }) {
  return <>
    <section className="v2-hero-card"><div><p className="v2-kicker">STEP 11 · DUAL-RUN PARITY & CUTOVER READINESS</p><h2>Migrated V2 shadows can now prove equivalence to their still-live nnn source without changing production traffic.</h2><p>Database configuration, domain aliases, Deriv OAuth settings, branding, preview approval, stable-source fingerprints, held registry/customization files and every referenced site bot asset are checked independently. One failure blocks readiness.</p></div><div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button className="v2-primary-button" type="button" onClick={onOpenParity}>Open cutover readiness</button><button className="v2-primary-button" type="button" onClick={onOpenMigration}>Open migration</button><button className="v2-primary-button" type="button" onClick={onCreateWebsite}>Create website</button><button className="v2-primary-button" type="button" onClick={onOpenDomains}>Open domains</button><button className="v2-primary-button" type="button" onClick={onOpenDeployments}>Open deployments</button><button className="v2-primary-button" type="button" onClick={onOpenCurrentManager}>Open current manager</button></div></section>
    <section className="v2-grid">
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">LIVE ↔ V2</span><h3>Current-state parity</h3></div><span className="v2-state good">RECOMPUTED</span></div><p>Every readiness read compares the latest V2 configuration and domains directly with the current audited legacy snapshot.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">HELD RUNTIME</span><h3>Asset parity</h3></div><span className="v2-state good">FINGERPRINTED</span></div><p>Registry, customization/defaults, bot manifests and referenced bot files are compared between exact stable-live and held-runtime Git checkouts.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">PRODUCTION</span><h3>No cutover</h3></div><span className="v2-state good">LOCKED</span></div><p>The Step 11 database contract keeps production_cutover_performed false. Readiness evidence cannot move traffic.</p></article>
    </section>
    <section className="v2-section"><div className="v2-section-heading"><div><p>FOUNDATION</p><h2>What is working now</h2></div></div><div className="v2-capability-grid">{capabilities.map(item => <div className="v2-capability" key={item}><span>✓</span><strong>{item}</strong></div>)}</div></section>
    <section className="v2-next-step"><div><p>NEXT MILESTONE</p><h2>Controlled cutover orchestration and rollback window</h2><span>Step 12 will build an operator-approved per-site cutover plan from parity-ready evidence, stage rollback information and require an explicit later action before production routing changes.</span></div><div className="v2-step-number">12</div></section>
  </>;
}
