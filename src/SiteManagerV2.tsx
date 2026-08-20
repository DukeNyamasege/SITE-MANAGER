import { useState } from 'react';
import AppV2 from './AppV2';
import { AuthProvider, AuthScreen, useAuth } from './auth';
import { CreateWebsiteView, MyWebsitesView } from './websites';
import './styles.css';
import './customization.css';
import './netlify-only.css';
import './v2.css';

type WorkspaceView = 'overview' | 'my-websites' | 'create-website' | 'current-manager' | 'account';

const capabilities = [
  'Verified customer accounts and VPS sessions',
  'One customer can own multiple websites',
  'Stable per-website identity and nnn template assignment',
  'Per-website USD 10/month billing record',
  'Existing domain manager preserved for migration',
  'GitHub validation and publishing preserved',
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

  const pageTitle = view === 'account' ? 'Your account'
    : view === 'my-websites' ? 'My Websites'
      : view === 'create-website' ? 'Create Website'
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
          <button className={view === 'my-websites' ? 'is-active' : ''} type="button" onClick={() => setView('my-websites')}>My Websites</button>
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
        {view === 'my-websites' && <MyWebsitesView onCreateWebsite={() => setView('create-website')} />}
        {view === 'create-website' && <CreateWebsiteView onCreated={() => setView('my-websites')} onCancel={() => setView('my-websites')} />}
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
          <p className="v2-kicker">OWNERSHIP FOUNDATION ACTIVE</p>
          <h2>Your account is now the permanent owner boundary for websites.</h2>
          <p>
            Website APIs use the authenticated VPS session to determine ownership. The browser cannot choose another customer ID,
            and every newly created website receives its own database identity and billing record.
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
          <p>All website reads and writes are filtered by this authenticated user ID on the server.</p>
        </article>
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">WEBSITE PLAN</span><h3>USD 10 / month</h3></div><span className="v2-state good">PER SITE</span></div>
          <p>Each website owns a separate subscription record. Billing activation and the free-month lifecycle come later.</p>
        </article>
      </section>

      <section className="v2-next-step">
        <div>
          <p>NEXT MILESTONE</p>
          <h2>Full Create Website V2 wizard</h2>
          <span>Turn a private draft into a configured `nnn` website with branding, features, Deriv setup, preview and deployment preparation.</span>
        </div>
        <div className="v2-step-number">04</div>
      </section>
    </>
  );
}

function OverviewView({ onOpenCurrentManager, onCreateWebsite }: { onOpenCurrentManager: () => void; onCreateWebsite: () => void }) {
  return (
    <>
      <section className="v2-hero-card">
        <div>
          <p className="v2-kicker">WEBSITE OWNERSHIP READY</p>
          <h2>A customer can now start with no website and create an owned draft.</h2>
          <p>
            The platform now knows who owns each website. Every draft starts on the reusable `nnn` template, requires no domain up front,
            and receives its own future USD 10/month subscription record.
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
          <p>Accounts, website ownership and the VPS API now live in the control plane.</p>
        </article>
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">SITE TEMPLATE</span><h3>DukeNyamasege/nnn</h3></div><span className="v2-state good">ACTIVE</span></div>
          <p>Every newly created website record starts with `template_id = nnn`; Step 4 will configure that template per site.</p>
        </article>
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">OWNERSHIP DATABASE</span><h3>PostgreSQL on VPS</h3></div><span className="v2-state good">V2</span></div>
          <p>Users, websites and one subscription record per website are connected by database foreign keys.</p>
        </article>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading"><div><p>STEP 3 FOUNDATION</p><h2>What is working now</h2></div></div>
        <div className="v2-capability-grid">
          {capabilities.map(item => <div className="v2-capability" key={item}><span>✓</span><strong>{item}</strong></div>)}
        </div>
      </section>

      <section className="v2-next-step">
        <div>
          <p>NEXT MILESTONE</p>
          <h2>Full Create Website V2 wizard</h2>
          <span>The next step will take these owned drafts through template configuration, branding, features, Deriv settings, preview and deployment preparation.</span>
        </div>
        <div className="v2-step-number">04</div>
      </section>
    </>
  );
}
