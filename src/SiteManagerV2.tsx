import { useState } from 'react';
import AppV2 from './AppV2';
import './styles.css';
import './customization.css';
import './netlify-only.css';
import './v2.css';

type WorkspaceView = 'overview' | 'current-manager';

const capabilities = [
  'Existing website/domain resolution',
  'Navigation and theme customization',
  'XML bot upload, ordering and removal',
  'New-site provisioning wizard',
  'GitHub PR validation and publishing',
  'Per-site configuration consumed by DukeNyamasege/nnn',
];

export default function SiteManagerV2() {
  const [view, setView] = useState<WorkspaceView>('overview');

  if (view === 'current-manager') {
    return (
      <div className="v2-legacy-shell">
        <div className="v2-development-bar">
          <div>
            <strong>Site Manager V2</strong>
            <span>Development workspace · current manager preserved</span>
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
          <button className="is-active" type="button">Overview</button>
          <button type="button" disabled>My Websites</button>
          <button type="button" disabled>Create Website</button>
          <button type="button" disabled>Templates</button>
          <button type="button" disabled>Domains</button>
          <button type="button" disabled>Deployments</button>
          <button type="button" disabled>Account</button>
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
            <h1>Site Manager V2</h1>
          </div>
          <span className="v2-chip">Internal development</span>
        </header>

        <section className="v2-hero-card">
          <div>
            <p className="v2-kicker">FOUNDATION READY</p>
            <h2>Build the new platform without throwing away the working manager.</h2>
            <p>
              The existing domain manager, site provisioning, bot management and GitHub publishing flow remain intact.
              New SaaS features will be added around them in controlled stages.
            </p>
          </div>
          <button className="v2-primary-button" type="button" onClick={() => setView('current-manager')}>
            Open current manager
          </button>
        </section>

        <section className="v2-grid">
          <article className="v2-card">
            <div className="v2-card-head">
              <div>
                <span className="v2-card-label">CONTROL PLANE</span>
                <h3>DukeNyamasege/SITE-MANAGER</h3>
              </div>
              <span className="v2-state good">ACTIVE</span>
            </div>
            <p>This repository remains the customer/admin control plane and owns the website management workflow.</p>
          </article>

          <article className="v2-card">
            <div className="v2-card-head">
              <div>
                <span className="v2-card-label">SITE RUNTIME</span>
                <h3>DukeNyamasege/nnn</h3>
              </div>
              <span className="v2-state good">ACTIVE</span>
            </div>
            <p>The current reusable trading template remains the runtime used by managed customer websites.</p>
          </article>

          <article className="v2-card">
            <div className="v2-card-head">
              <div>
                <span className="v2-card-label">PUBLIC WEBSITE</span>
                <h3>Maintenance mode</h3>
              </div>
              <span className="v2-state hold">HELD</span>
            </div>
            <p>The deployed Netlify site remains on the Under Development page while this workspace evolves.</p>
          </article>
        </section>

        <section className="v2-section">
          <div className="v2-section-heading">
            <div>
              <p>WHAT WE ARE KEEPING</p>
              <h2>Existing working capabilities</h2>
            </div>
          </div>
          <div className="v2-capability-grid">
            {capabilities.map(item => (
              <div className="v2-capability" key={item}>
                <span>✓</span>
                <strong>{item}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="v2-next-step">
          <div>
            <p>NEXT MILESTONE</p>
            <h2>Customer accounts, authentication and site ownership</h2>
            <span>
              Replace domain-only access with real user accounts, then attach one or more managed websites to each authenticated customer.
            </span>
          </div>
          <div className="v2-step-number">02</div>
        </section>
      </main>
    </div>
  );
}
