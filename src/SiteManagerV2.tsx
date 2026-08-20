import { useState } from 'react';
import AppV2 from './AppV2';
import { AuthProvider, AuthScreen, useAuth } from './auth';
import { WebsiteBuilderView } from './builder';
import { RuntimePreviewView } from './runtime-preview';
import { CreateWebsiteView, MyWebsitesView, type WebsiteRecord } from './websites';
import './styles.css';
import './customization.css';
import './netlify-only.css';
import './v2.css';

type WorkspaceView = 'overview' | 'my-websites' | 'create-website' | 'builder' | 'runtime-preview' | 'current-manager' | 'account';

const capabilities = [
  'Verified customer accounts and VPS sessions',
  'One customer can own multiple websites',
  'Five-step per-website nnn configuration builder',
  'Live Site Manager → nnn runtime configuration channel',
  'Private real-template previews with trading disabled',
  'Per-website USD 10/month billing record',
];

export default function SiteManagerV2() {
  return (
    <AuthProvider>
      <AuthenticatedWorkspace />
    </AuthProvider>
  );
}

function AuthenticatedWorkspace() {
  const { user, loading, logout } = useAuth();
  const [view, setView] = useState<WorkspaceView>('overview');
  const [builderWebsiteId, setBuilderWebsiteId] = useState('');
  const [previewWebsiteId, setPreviewWebsiteId] = useState('');

  if (loading) return <main className="auth-loading">Checking your Site Manager account…</main>;
  if (!user) return <AuthScreen />;

  if (view === 'current-manager') {
    return (
      <div className="v2-legacy-shell">
        <div className="v2-development-bar">
          <div>
            <strong>Site Manager V2</strong>
            <span>Development workspace · current domain manager preserved during migration</span>
          </div>
          <button type="button" onClick={() => setView('overview')}>Back to V2 overview</button>
        </div>
        <AppV2 />
      </div>
    );
  }

  const openBuilder = (website: WebsiteRecord) => {
    setBuilderWebsiteId(website.id);
    setView('builder');
  };

  const openPreview = (website: WebsiteRecord) => {
    setPreviewWebsiteId(website.id);
    setView('runtime-preview');
  };

  const editPreviewedWebsite = () => {
    if (!previewWebsiteId) return;
    setBuilderWebsiteId(previewWebsiteId);
    setView('builder');
  };

  const pageTitle = view === 'account' ? 'Your account'
    : view === 'my-websites' ? 'My Websites'
      : view === 'create-website' ? 'Create Website'
        : view === 'builder' ? 'Website Builder'
          : view === 'runtime-preview' ? 'Preview & Assets'
            : 'Site Manager V2';

  const websitesActive = ['my-websites', 'builder', 'runtime-preview'].includes(view);

  return (
    <div className="v2-shell">
      <aside className="v2-sidebar">
        <div className="v2-brand">
          <div className="v2-brand-mark">SM</div>
          <div>
            <strong>Site Manager</strong>
            <small>V2 Development</small>
          </div>
        </div>

        <nav className="v2-nav" aria-label="Site Manager V2 development navigation">
          <button className={view === 'overview' ? 'is-active' : ''} type="button" onClick={() => setView('overview')}>Overview</button>
          <button className={websitesActive ? 'is-active' : ''} type="button" onClick={() => setView('my-websites')}>My Websites</button>
          <button className={view === 'create-website' ? 'is-active' : ''} type="button" onClick={() => setView('create-website')}>Create Website</button>
          <button type="button" disabled>Templates</button>
          <button type="button" disabled>Domains</button>
          <button type="button" disabled>Deployments</button>
          <button className={view === 'account' ? 'is-active' : ''} type="button" onClick={() => setView('account')}>Account</button>
        </nav>

        <div className="v2-sidebar-footer">
          <span className="v2-status-dot" />
          Netlify deployment paused
        </div>
      </aside>

      <main className="v2-main">
        <header className="v2-topbar">
          <div>
            <p>DEVELOPMENT WORKSPACE</p>
            <h1>{pageTitle}</h1>
          </div>
          <div className="v2-account-chip">
            <div>
              <strong>{user.display_name || 'Site Manager customer'}</strong>
              <small>{user.email}</small>
            </div>
            <button type="button" onClick={() => void logout()}>Sign out</button>
          </div>
        </header>

        {view === 'account' && <AccountView />}
        {view === 'overview' && <OverviewView onOpenCurrentManager={() => setView('current-manager')} onCreateWebsite={() => setView('create-website')} />}
        {view === 'my-websites' && <MyWebsitesView onCreateWebsite={() => setView('create-website')} onContinueSetup={openBuilder} onPreviewWebsite={openPreview} />}
        {view === 'create-website' && <CreateWebsiteView onCreated={openBuilder} onCancel={() => setView('my-websites')} />}
        {view === 'builder' && builderWebsiteId && <WebsiteBuilderView websiteId={builderWebsiteId} onBack={() => setView('my-websites')} onCompleted={() => setView('my-websites')} />}
        {view === 'runtime-preview' && previewWebsiteId && <RuntimePreviewView websiteId={previewWebsiteId} onBack={() => setView('my-websites')} onEditSetup={editPreviewedWebsite} />}
      </main>
    </div>
  );
}

function AccountView() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <>
      <section className="v2-hero-card">
        <div>
          <p className="v2-kicker">RUNTIME BRIDGE ACTIVE</p>
          <h2>Your website configuration now reaches the real nnn runtime.</h2>
          <p>
            Site Manager remains the VPS source of truth. The nnn template can consume per-site branding, navigation, colors and Deriv preparation dynamically while existing static sites keep their fallback configuration.
          </p>
        </div>
      </section>

      <section className="v2-grid">
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">EMAIL</span><h3>{user.email}</h3></div><span className="v2-state good">VERIFIED</span></div>
          <p>Email verification remains required before Site Manager issues an authenticated customer session.</p>
        </article>
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">PRIVATE PREVIEW</span><h3>Real nnn runtime</h3></div><span className="v2-state good">SAFE</span></div>
          <p>Short-lived preview sessions render the actual template while OAuth/session restoration and live trading bridges are disabled.</p>
        </article>
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">WEBSITE PLAN</span><h3>USD 10 / month</h3></div><span className="v2-state good">PER SITE</span></div>
          <p>Billing is still inactive during configuration and preview. The subscription lifecycle will start only at the later activation milestone.</p>
        </article>
      </section>

      <section className="v2-next-step">
        <div>
          <p>NEXT MILESTONE</p>
          <h2>Domains and VPS deployment readiness</h2>
          <span>Connect an existing domain or platform address, verify ownership, prepare HTTPS/routing and move a preview-approved nnn site toward a real VPS deployment.</span>
        </div>
        <div className="v2-step-number">06</div>
      </section>
    </>
  );
}

function OverviewView({ onOpenCurrentManager, onCreateWebsite }: { onOpenCurrentManager: () => void; onCreateWebsite: () => void }) {
  return (
    <>
      <section className="v2-hero-card">
        <div>
          <p className="v2-kicker">REAL NNN PREVIEW ACTIVE</p>
          <h2>Site Manager and the template now speak the same runtime configuration contract.</h2>
          <p>
            Customers can create a site without a domain, configure it in PostgreSQL, upload its logo to VPS storage and inspect the actual nnn landing page or app shell before anything is publicly deployed.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="v2-primary-button" type="button" onClick={onCreateWebsite}>Create website</button>
          <button className="v2-primary-button" type="button" onClick={onOpenCurrentManager}>Open current manager</button>
        </div>
      </section>

      <section className="v2-grid">
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">CONTROL PLANE</span><h3>DukeNyamasege/SITE-MANAGER</h3></div><span className="v2-state good">SOURCE OF TRUTH</span></div>
          <p>Accounts, ownership, builder configuration, preview sessions and uploaded site assets live in the VPS-oriented control plane.</p>
        </article>
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">SITE TEMPLATE</span><h3>DukeNyamasege/nnn</h3></div><span className="v2-state good">RUNTIME READY</span></div>
          <p>nnn now prefers Site Manager runtime state for managed previews/sites and falls back to its existing static configuration for current websites.</p>
        </article>
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">PRIVATE PREVIEW</span><h3>No domain required</h3></div><span className="v2-state good">STEP 5</span></div>
          <p>Short-lived preview tokens let the real template render the latest database-backed customer configuration without publishing it.</p>
        </article>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading"><div><p>STEP 5 FOUNDATION</p><h2>What is working now</h2></div></div>
        <div className="v2-capability-grid">
          {capabilities.map(item => <div className="v2-capability" key={item}><span>✓</span><strong>{item}</strong></div>)}
        </div>
      </section>

      <section className="v2-next-step">
        <div>
          <p>NEXT MILESTONE</p>
          <h2>Domains and VPS deployment readiness</h2>
          <span>Step 6 will take a preview-approved website into domain selection/connection, ownership verification, HTTPS and VPS routing preparation without starting billing prematurely.</span>
        </div>
        <div className="v2-step-number">06</div>
      </section>
    </>
  );
}
