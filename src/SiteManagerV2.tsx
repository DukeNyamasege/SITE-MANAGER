import { useState } from 'react';
import AppV2 from './AppV2';
import { AuthProvider, AuthScreen, useAuth } from './auth';
import { WebsiteBuilderView } from './builder';
import { DeploymentsWorkspace } from './deployments';
import { DomainsWorkspace } from './domains';
import { RuntimePreviewView } from './runtime-preview';
import { CreateWebsiteView, MyWebsitesView, type WebsiteRecord } from './websites';
import './styles.css';
import './customization.css';
import './netlify-only.css';
import './v2.css';

type WorkspaceView = 'overview' | 'my-websites' | 'create-website' | 'builder' | 'runtime-preview' | 'domains' | 'deployments' | 'current-manager' | 'account';

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
        <button className={view === 'account' ? 'is-active' : ''} type="button" onClick={() => setView('account')}>Account</button>
      </nav>
      <div className="v2-sidebar-footer"><span className="v2-status-dot" />Netlify deployment paused</div>
    </aside>

    <main className="v2-main">
      <header className="v2-topbar"><div><p>DEVELOPMENT WORKSPACE</p><h1>{pageTitle}</h1></div><div className="v2-account-chip"><div><strong>{user.display_name || 'Site Manager customer'}</strong><small>{user.email}</small></div><button type="button" onClick={() => void logout()}>Sign out</button></div></header>
      {view === 'account' && <AccountView />}
      {view === 'overview' && <OverviewView onOpenCurrentManager={() => setView('current-manager')} onCreateWebsite={() => setView('create-website')} onOpenDomains={() => setView('domains')} onOpenDeployments={() => setView('deployments')} />}
      {view === 'my-websites' && <MyWebsitesView onCreateWebsite={() => setView('create-website')} onContinueSetup={openBuilder} onPreviewWebsite={openPreview} onManageDomains={openDomains} />}
      {view === 'create-website' && <CreateWebsiteView onCreated={openBuilder} onCancel={() => setView('my-websites')} />}
      {view === 'builder' && builderWebsiteId && <WebsiteBuilderView websiteId={builderWebsiteId} onBack={() => setView('my-websites')} onCompleted={() => setView('my-websites')} />}
      {view === 'runtime-preview' && previewWebsiteId && <RuntimePreviewView websiteId={previewWebsiteId} onBack={() => setView('my-websites')} onEditSetup={editPreviewedWebsite} />}
      {view === 'domains' && <DomainsWorkspace initialWebsiteId={domainWebsiteId} focus="domains" />}
      {view === 'deployments' && <DeploymentsWorkspace initialWebsiteId={domainWebsiteId} />}
    </main>
  </div>;
}

function AccountView() {
  const { user } = useAuth();
  if (!user) return null;
  return <>
    <section className="v2-hero-card"><div><p className="v2-kicker">VPS HOST PACKAGE</p><h2>The control plane and shared nnn runtime now have a defined production home, release model and rollback path.</h2><p>Site Manager runs as a hardened systemd Node service, PostgreSQL keeps persistent control-plane state, Caddy owns HTTPS and hostname routing, and one immutable nnn release serves previews plus customer websites.</p></div></section>
    <section className="v2-grid">
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">EMAIL</span><h3>{user.email}</h3></div><span className="v2-state good">VERIFIED</span></div><p>Email verification protects the customer control plane.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">RUNTIME</span><h3>One shared nnn build</h3></div><span className="v2-state good">RELEASE SAFE</span></div><p>nnn is installed once under an atomic current-release symlink and requires explicit cutover approval before activation.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">PAYMENT</span><h3>Designed later</h3></div><span className="v2-state">DEFERRED</span></div><p>No checkout, trial clock or payment gate participates in publishing or VPS installation.</p></article>
    </section>
    <section className="v2-next-step"><div><p>NEXT MILESTONE</p><h2>Staging VPS and end-to-end cutover rehearsal</h2><span>Step 9 will exercise the complete lifecycle on an isolated staging host: install services, load the held nnn integration, configure preview/DNS, publish test websites, test rollback and verify that existing production nnn sites remain untouched.</span></div><div className="v2-step-number">09</div></section>
  </>;
}

function OverviewView({ onOpenCurrentManager, onCreateWebsite, onOpenDomains, onOpenDeployments }: { onOpenCurrentManager: () => void; onCreateWebsite: () => void; onOpenDomains: () => void; onOpenDeployments: () => void }) {
  return <>
    <section className="v2-hero-card"><div><p className="v2-kicker">STEP 8 · VPS INSTALLATION PACKAGE</p><h2>The publishing engine now has an exact host layout instead of a collection of manual SSH assumptions.</h2><p>Immutable releases, systemd, PostgreSQL secrets, Caddy manager/preview/customer routing, persistent uploads, daily backups and rollback are packaged in source. Production nnn/main remains isolated until explicit final cutover.</p></div><div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button className="v2-primary-button" type="button" onClick={onCreateWebsite}>Create website</button><button className="v2-primary-button" type="button" onClick={onOpenDomains}>Open domains</button><button className="v2-primary-button" type="button" onClick={onOpenDeployments}>Open deployments</button><button className="v2-primary-button" type="button" onClick={onOpenCurrentManager}>Open current manager</button></div></section>
    <section className="v2-grid">
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">CONTROL PLANE</span><h3>systemd + PostgreSQL</h3></div><span className="v2-state good">PACKAGED</span></div><p>Site Manager runs without root, secrets stay outside Git and persistent state is separated from immutable application releases.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">SITE TEMPLATE</span><h3>Shared nnn releases</h3></div><span className="v2-state good">PR-ONLY</span></div><p>The integration build is validated as a deployable artifact but remains in draft PR #48; current nnn/main users stay on the stable production code.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">EDGE</span><h3>Caddy + HTTPS</h3></div><span className="v2-state good">DEFINED</span></div><p>Manager, private preview and generated customer routes share one edge and one nnn distribution, with plan mode remaining the default.</p></article>
    </section>
    <section className="v2-section"><div className="v2-section-heading"><div><p>FOUNDATION</p><h2>What is working now</h2></div></div><div className="v2-capability-grid">{capabilities.map(item => <div className="v2-capability" key={item}><span>✓</span><strong>{item}</strong></div>)}</div></section>
    <section className="v2-next-step"><div><p>NEXT MILESTONE</p><h2>Staging VPS and end-to-end cutover rehearsal</h2><span>Step 9 will prove the package on an isolated staging environment before any production nnn merge or customer-site cutover is allowed.</span></div><div className="v2-step-number">09</div></section>
  </>;
}
