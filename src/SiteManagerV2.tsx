import { useState } from 'react';
import AppV2 from './AppV2';
import { AuthProvider, AuthScreen, useAuth } from './auth';
import { WebsiteBuilderView } from './builder';
import { CreateWebsiteView, MyWebsitesView, type WebsiteRecord } from './websites';
import './styles.css';
import './customization.css';
import './netlify-only.css';
import './v2.css';

type WorkspaceView = 'overview' | 'my-websites' | 'create-website' | 'builder' | 'current-manager' | 'account';

const capabilities = [
  'Verified customer accounts and VPS sessions',
  'One customer can own multiple websites',
  'Five-step per-website nnn configuration builder',
  'Exact nnn navigation/theme configuration bridge',
  'Per-website USD 10/month billing record',
  'Existing domain manager preserved for migration',
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

  const pageTitle = view === 'account' ? 'Your account'
    : view === 'my-websites' ? 'My Websites'
      : view === 'create-website' ? 'Create Website'
        : view === 'builder' ? 'Website Builder'
          : 'Site Manager V2';

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
          <button className={view === 'my-websites' || view === 'builder' ? 'is-active' : ''} type="button" onClick={() => setView('my-websites')}>My Websites</button>
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
        {view === 'my-websites' && <MyWebsitesView onCreateWebsite={() => setView('create-website')} onContinueSetup={openBuilder} />}
        {view === 'create-website' && <CreateWebsiteView onCreated={openBuilder} onCancel={() => setView('my-websites')} />}
        {view === 'builder' && builderWebsiteId && <WebsiteBuilderView websiteId={builderWebsiteId} onBack={() => setView('my-websites')} onCompleted={() => setView('my-websites')} />}
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
          <p className="v2-kicker">WEBSITE BUILDER ACTIVE</p>
          <h2>Your account owns website drafts and their complete template configuration.</h2>
          <p>
            Each website now stores its own identity, theme, visible trading features and Deriv OAuth preparation in PostgreSQL.
            Site Manager projects the compatible fields into the existing nnn configuration contract.
          </p>
        </div>
      </section>

      <section className="v2-grid">
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">EMAIL</span><h3>{user.email}</h3></div><span className="v2-state good">VERIFIED</span></div>
          <p>Email verification remains required before Site Manager issues an authenticated customer session.</p>
        </article>
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">OWNERSHIP ID</span><h3>{user.id.slice(0, 8)}…</h3></div><span className="v2-state good">ACTIVE</span></div>
          <p>All website and builder reads/writes are filtered by this authenticated user ID on the server.</p>
        </article>
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">WEBSITE PLAN</span><h3>USD 10 / month</h3></div><span className="v2-state good">PER SITE</span></div>
          <p>Each website owns a separate subscription record. Billing activation and the free-month lifecycle still come later.</p>
        </article>
      </section>

      <section className="v2-next-step">
        <div>
          <p>NEXT MILESTONE</p>
          <h2>Real nnn preview and expanded per-site branding</h2>
          <span>Run completed drafts through the actual template before domain/deployment, add first-class logo/branding support to nnn and prepare site publishing from the VPS control plane.</span>
        </div>
        <div className="v2-step-number">05</div>
      </section>
    </>
  );
}

function OverviewView({ onOpenCurrentManager, onCreateWebsite }: { onOpenCurrentManager: () => void; onCreateWebsite: () => void }) {
  return (
    <>
      <section className="v2-hero-card">
        <div>
          <p className="v2-kicker">CREATE WEBSITE V2 ACTIVE</p>
          <h2>A customer can now create and configure an nnn website without owning a domain.</h2>
          <p>
            A new draft moves through identity, appearance, trading features, Deriv preparation and review. The resulting configuration is stored on the VPS database and projected into the current nnn contract.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="v2-primary-button" type="button" onClick={onCreateWebsite}>Create website</button>
          <button className="v2-primary-button" type="button" onClick={onOpenCurrentManager}>Open current manager</button>
        </div>
      </section>

      <section className="v2-grid">
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">CONTROL PLANE</span><h3>DukeNyamasege/SITE-MANAGER</h3></div><span className="v2-state good">ACTIVE</span></div>
          <p>Accounts, website ownership, builder drafts and the VPS API live in the control plane.</p>
        </article>
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">SITE TEMPLATE</span><h3>DukeNyamasege/nnn</h3></div><span className="v2-state good">BRIDGED</span></div>
          <p>The builder uses the exact current nnn navigation catalog and five-color site customization contract.</p>
        </article>
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">DRAFT STORAGE</span><h3>PostgreSQL on VPS</h3></div><span className="v2-state good">V2</span></div>
          <p>Incomplete setup survives browser sessions and can be resumed from My Websites.</p>
        </article>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading"><div><p>STEP 4 FOUNDATION</p><h2>What is working now</h2></div></div>
        <div className="v2-capability-grid">
          {capabilities.map(item => <div className="v2-capability" key={item}><span>✓</span><strong>{item}</strong></div>)}
        </div>
      </section>

      <section className="v2-next-step">
        <div>
          <p>NEXT MILESTONE</p>
          <h2>Real nnn preview and expanded per-site branding</h2>
          <span>Step 5 will make a completed draft render through the actual nnn runtime before domain/deployment and extend the template so brand name, tagline and logo are true per-site runtime properties.</span>
        </div>
        <div className="v2-step-number">05</div>
      </section>
    </>
  );
}
