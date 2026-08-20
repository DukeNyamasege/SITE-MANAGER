import { useState } from 'react';
import AppV2 from './AppV2';
import { AuthProvider, AuthScreen, useAuth } from './auth';
import './styles.css';
import './customization.css';
import './netlify-only.css';
import './v2.css';

type WorkspaceView = 'overview' | 'current-manager' | 'account';

const capabilities = [
  'Existing website/domain resolution',
  'Navigation and theme customization',
  'XML bot upload, ordering and removal',
  'New-site provisioning wizard',
  'GitHub PR validation and publishing',
  'Per-site configuration consumed by DukeNyamasege/nnn',
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
          <button type="button" disabled>My Websites</button>
          <button type="button" disabled>Create Website</button>
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
            <h1>{view === 'account' ? 'Your account' : 'Site Manager V2'}</h1>
          </div>
          <div className="v2-account-chip">
            <div>
              <strong>{user.display_name || 'Site Manager customer'}</strong>
              <small>{user.email}</small>
            </div>
            <button type="button" onClick={() => void logout()}>Sign out</button>
          </div>
        </header>

        {view === 'account' ? (
          <AccountView />
        ) : (
          <OverviewView onOpenCurrentManager={() => setView('current-manager')} />
        )}
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
          <p className="v2-kicker">ACCOUNT FOUNDATION ACTIVE</p>
          <h2>Your identity now sits above every website you will create.</h2>
          <p>
            Domain names are no longer the long-term login model. This verified account will become the owner of your sites,
            domains, deployments and individual subscriptions as the next milestones are connected.
          </p>
        </div>
      </section>

      <section className="v2-grid">
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">EMAIL</span><h3>{user.email}</h3></div><span className="v2-state good">VERIFIED</span></div>
          <p>Email verification is required before Site Manager creates an authenticated session.</p>
        </article>
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">ACCOUNT ID</span><h3>{user.id.slice(0, 8)}…</h3></div><span className="v2-state good">ACTIVE</span></div>
          <p>Your permanent user ID will be used as the ownership boundary for websites and billing records.</p>
        </article>
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">SECURITY</span><h3>Server-side session</h3></div><span className="v2-state good">SECURE</span></div>
          <p>The browser receives an opaque HttpOnly cookie. Password hashes and live session records remain on the VPS database.</p>
        </article>
      </section>

      <section className="v2-next-step">
        <div>
          <p>NEXT MILESTONE</p>
          <h2>Website ownership and My Websites</h2>
          <span>Attach existing and newly created websites to this account, with one $10/month subscription lifecycle per website.</span>
        </div>
        <div className="v2-step-number">03</div>
      </section>
    </>
  );
}

function OverviewView({ onOpenCurrentManager }: { onOpenCurrentManager: () => void }) {
  return (
    <>
      <section className="v2-hero-card">
        <div>
          <p className="v2-kicker">AUTHENTICATION READY</p>
          <h2>The platform now starts with a real customer account.</h2>
          <p>
            The V2 workspace is protected by VPS-ready account authentication while the existing domain manager,
            site provisioning, bot management and GitHub publishing flow remain available for controlled migration.
          </p>
        </div>
        <button className="v2-primary-button" type="button" onClick={onOpenCurrentManager}>Open current manager</button>
      </section>

      <section className="v2-grid">
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">CONTROL PLANE</span><h3>DukeNyamasege/SITE-MANAGER</h3></div><span className="v2-state good">ACTIVE</span></div>
          <p>This repository remains the customer/admin control plane and owns the website management workflow.</p>
        </article>
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">SITE RUNTIME</span><h3>DukeNyamasege/nnn</h3></div><span className="v2-state good">ACTIVE</span></div>
          <p>The reusable trading template remains the runtime used by managed customer websites.</p>
        </article>
        <article className="v2-card">
          <div className="v2-card-head"><div><span className="v2-card-label">AUTH DATABASE</span><h3>PostgreSQL on VPS</h3></div><span className="v2-state good">V2</span></div>
          <p>Customer identities, Argon2id password hashes, sessions and recovery tokens now have a VPS-native data model.</p>
        </article>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading"><div><p>WHAT WE ARE KEEPING</p><h2>Existing working capabilities</h2></div></div>
        <div className="v2-capability-grid">
          {capabilities.map(item => <div className="v2-capability" key={item}><span>✓</span><strong>{item}</strong></div>)}
        </div>
      </section>

      <section className="v2-next-step">
        <div>
          <p>NEXT MILESTONE</p>
          <h2>Website ownership and My Websites</h2>
          <span>Every authenticated customer will own one or more websites, including sites created from scratch and existing sites migrated from the current template configuration.</span>
        </div>
        <div className="v2-step-number">03</div>
      </section>
    </>
  );
}
