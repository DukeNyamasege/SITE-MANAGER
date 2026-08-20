import { useState } from 'react';
import AppV2 from './AppV2';
import { AuthProvider, AuthScreen, useAuth } from './auth';
import { WebsiteBuilderView } from './builder';
import { CanaryCutoverWorkspace } from './canary';
import { CutoverOrchestrationWorkspace } from './cutover';
import { DeploymentsWorkspace } from './deployments';
import { DomainsWorkspace } from './domains';
import { LegacyMigrationWorkspace } from './legacy-migration';
import { CutoverReadinessWorkspace } from './parity';
import { RuntimePreviewView } from './runtime-preview';
import { StagingEdgeWorkspace } from './staging-edge';
import { CreateWebsiteView, MyWebsitesView, type WebsiteRecord } from './websites';
import './styles.css';
import './customization.css';
import './netlify-only.css';
import './v2.css';

type WorkspaceView = 'overview' | 'my-websites' | 'create-website' | 'builder' | 'runtime-preview' | 'domains' | 'deployments' | 'legacy-migration' | 'cutover-readiness' | 'cutover-orchestration' | 'canary-cutover' | 'staging-edge' | 'current-manager' | 'account';

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
  'Immutable operator cutover plans pinned to exact parity evidence',
  'Cutover arming revalidates source, held nnn, V2 and VPS target state',
  'Simulation-only one-site canary execution with a platform-wide concurrency lock',
  'Rollback timer begins only after held-nnn health criteria pass',
  'Automatic rollback drill restores the frozen legacy snapshot on canary health failure',
  'Migrated sites blocked from bypassing cutover through ordinary customer publishing',
  'Dedicated real staging Caddy edge with a separate admin endpoint and Caddyfile',
  'Real HTTPS staging health checks against the exact held nnn build and Site Manager runtime API',
  'Persistent staging monitor recovers after Site Manager restarts and rolls back on repeated failure',
  'Staging nnn runtime reuses the preview non-trading safety posture',
  'Staging and production nnn release approvals are separate',
  'Production traffic and production cutover remain database-locked during staging',
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
                    : view === 'cutover-orchestration' ? 'Cutover Plans'
                      : view === 'canary-cutover' ? 'Canary Drill'
                        : view === 'staging-edge' ? 'Staging Edge'
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
        <button className={view === 'cutover-orchestration' ? 'is-active' : ''} type="button" onClick={() => setView('cutover-orchestration')}>Cutover Plans</button>
        <button className={view === 'canary-cutover' ? 'is-active' : ''} type="button" onClick={() => setView('canary-cutover')}>Canary Drill</button>
        <button className={view === 'staging-edge' ? 'is-active' : ''} type="button" onClick={() => setView('staging-edge')}>Staging Edge</button>
        <button className={view === 'account' ? 'is-active' : ''} type="button" onClick={() => setView('account')}>Account</button>
      </nav>
      <div className="v2-sidebar-footer"><span className="v2-status-dot" />Netlify deployment paused</div>
    </aside>

    <main className="v2-main">
      <header className="v2-topbar"><div><p>DEVELOPMENT WORKSPACE</p><h1>{pageTitle}</h1></div><div className="v2-account-chip"><div><strong>{user.display_name || 'Site Manager customer'}</strong><small>{user.email}</small></div><button type="button" onClick={() => void logout()}>Sign out</button></div></header>
      {view === 'account' && <AccountView />}
      {view === 'overview' && <OverviewView onOpenCurrentManager={() => setView('current-manager')} onCreateWebsite={() => setView('create-website')} onOpenDomains={() => setView('domains')} onOpenDeployments={() => setView('deployments')} onOpenMigration={() => setView('legacy-migration')} onOpenParity={() => setView('cutover-readiness')} onOpenCutover={() => setView('cutover-orchestration')} onOpenCanary={() => setView('canary-cutover')} onOpenStaging={() => setView('staging-edge')} />}
      {view === 'my-websites' && <MyWebsitesView onCreateWebsite={() => setView('create-website')} onContinueSetup={openBuilder} onPreviewWebsite={openPreview} onManageDomains={openDomains} />}
      {view === 'create-website' && <CreateWebsiteView onCreated={openBuilder} onCancel={() => setView('my-websites')} />}
      {view === 'builder' && builderWebsiteId && <WebsiteBuilderView websiteId={builderWebsiteId} onBack={() => setView('my-websites')} onCompleted={() => setView('my-websites')} />}
      {view === 'runtime-preview' && previewWebsiteId && <RuntimePreviewView websiteId={previewWebsiteId} onBack={() => setView('my-websites')} onEditSetup={editPreviewedWebsite} />}
      {view === 'domains' && <DomainsWorkspace initialWebsiteId={domainWebsiteId} focus="domains" />}
      {view === 'deployments' && <DeploymentsWorkspace initialWebsiteId={domainWebsiteId} />}
      {view === 'legacy-migration' && <LegacyMigrationWorkspace />}
      {view === 'cutover-readiness' && <CutoverReadinessWorkspace />}
      {view === 'cutover-orchestration' && <CutoverOrchestrationWorkspace />}
      {view === 'canary-cutover' && <CanaryCutoverWorkspace />}
      {view === 'staging-edge' && <StagingEdgeWorkspace />}
    </main>
  </div>;
}

function AccountView() {
  const { user } = useAuth();
  if (!user) return null;
  return <>
    <section className="v2-hero-card"><div><p className="v2-kicker">STEP 14 · REAL STAGING EDGE + CUTOVER MONITOR</p><h2>The proven canary state machine now has a real HTTPS reverse-proxy adapter for an isolated staging hostname.</h2><p>Step 14 serves the exact held nnn build through its own staging Caddy process, verifies runtime/site identity over HTTPS and persists monitor state in PostgreSQL so a Site Manager restart resumes health supervision instead of forgetting the active rehearsal.</p></div></section>
    <section className="v2-grid">
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">EMAIL</span><h3>{user.email}</h3></div><span className="v2-state good">VERIFIED</span></div><p>Email verification protects the customer control plane.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">STAGING EDGE</span><h3>Dedicated Caddy</h3></div><span className="v2-state good">ISOLATED</span></div><p>Staging has a separate hostname, Caddyfile, admin endpoint, approval flag and runtime token channel.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">PAYMENT</span><h3>Designed later</h3></div><span className="v2-state">DEFERRED</span></div><p>No checkout, trial clock or payment gate participates in staging or cutover verification.</p></article>
    </section>
    <section className="v2-next-step"><div><p>NEXT MILESTONE</p><h2>Production cutover adapter and explicit one-site live approval gate</h2><span>Step 15 will build the production-only route execution contract from the now-proven staging adapter, with an explicit operator approval, one migrated site at a time, immediate health verification and rollback protection. It will remain disabled by default until an actual production cutover is explicitly authorized.</span></div><div className="v2-step-number">15</div></section>
  </>;
}

function OverviewView({ onOpenCurrentManager, onCreateWebsite, onOpenDomains, onOpenDeployments, onOpenMigration, onOpenParity, onOpenCutover, onOpenCanary, onOpenStaging }: { onOpenCurrentManager: () => void; onCreateWebsite: () => void; onOpenDomains: () => void; onOpenDeployments: () => void; onOpenMigration: () => void; onOpenParity: () => void; onOpenCutover: () => void; onOpenCanary: () => void; onOpenStaging: () => void }) {
  return <>
    <section className="v2-hero-card"><div><p className="v2-kicker">STEP 14 · REAL STAGING-HOST EXECUTION ADAPTER + CUTOVER MONITOR</p><h2>The held nnn runtime can now be exercised behind a dedicated real Caddy/HTTPS staging edge before any customer hostname is touched.</h2><p>A passed Step 13 canary can progress to a staging-only route. Site Manager injects a short-lived runtime credential, validates the exact held nnn contract and site identity through HTTPS, persists the rollback window, resumes monitoring after restarts and automatically removes the staging route after repeated health failure.</p></div><div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button className="v2-primary-button" type="button" onClick={onOpenStaging}>Open staging edge</button><button className="v2-primary-button" type="button" onClick={onOpenCanary}>Open canary drill</button><button className="v2-primary-button" type="button" onClick={onOpenCutover}>Open cutover plans</button><button className="v2-primary-button" type="button" onClick={onOpenParity}>Open readiness</button><button className="v2-primary-button" type="button" onClick={onOpenMigration}>Open migration</button><button className="v2-primary-button" type="button" onClick={onCreateWebsite}>Create website</button><button className="v2-primary-button" type="button" onClick={onOpenDomains}>Open domains</button><button className="v2-primary-button" type="button" onClick={onOpenDeployments}>Open deployments</button><button className="v2-primary-button" type="button" onClick={onOpenCurrentManager}>Open current manager</button></div></section>
    <section className="v2-grid">
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">EDGE</span><h3>Real HTTPS</h3></div><span className="v2-state good">STAGING ONLY</span></div><p>The Step 14 adapter calls real Caddy validate/reload and then requests the shared nnn runtime through HTTPS.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">RECOVERY</span><h3>Persistent monitor</h3></div><span className="v2-state good">RESTART SAFE</span></div><p>PostgreSQL stores the active run, health state and rollback deadline so a Site Manager restart resumes supervision.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">PRODUCTION</span><h3>Still unchanged</h3></div><span className="v2-state good">LOCKED</span></div><p>The staging schema cannot represent production traffic movement or production cutover, and its Caddyfile is separate from customer routes.</p></article>
    </section>
    <section className="v2-section"><div className="v2-section-heading"><div><p>FOUNDATION</p><h2>What is working now</h2></div></div><div className="v2-capability-grid">{capabilities.map(item => <div className="v2-capability" key={item}><span>✓</span><strong>{item}</strong></div>)}</div></section>
    <section className="v2-next-step"><div><p>NEXT MILESTONE</p><h2>Production cutover adapter and explicit one-site live approval gate</h2><span>Step 15 will translate the proven staging route/health/rollback mechanics into a production-only adapter with stronger explicit authorization. It will remain disabled by default and still operate one migrated site at a time.</span></div><div className="v2-step-number">15</div></section>
  </>;
}
