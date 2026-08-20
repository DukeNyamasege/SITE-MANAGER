import { useEffect, useState } from 'react';
import AppV2 from './AppV2';
import { AuthProvider, AuthScreen, useAuth } from './auth';
import { WebsiteBuilderView } from './builder';
import { CanaryCutoverWorkspace } from './canary';
import { CutoverOrchestrationWorkspace } from './cutover';
import { DeploymentsWorkspace } from './deployments';
import { DomainFirstOnboardingView, type DomainOnboardingIntent } from './domain-onboarding';
import { DomainsWorkspace } from './domains';
import { LegacyMigrationWorkspace } from './legacy-migration';
import { CutoverReadinessWorkspace } from './parity';
import { ProductionEligibilityWorkspace } from './production-eligibility';
import { RuntimePreviewView } from './runtime-preview';
import { StagingEdgeWorkspace } from './staging-edge';
import { CreateWebsiteView, MyWebsitesView, type WebsiteRecord } from './websites';
import './styles.css';
import './customization.css';
import './netlify-only.css';
import './v2.css';

type WorkspaceView = 'overview' | 'my-websites' | 'domain-onboarding' | 'create-website' | 'builder' | 'runtime-preview' | 'domains' | 'deployments' | 'legacy-migration' | 'cutover-readiness' | 'cutover-orchestration' | 'canary-cutover' | 'staging-edge' | 'production-eligibility' | 'current-manager' | 'account';

const capabilities = [
  'Verified customer accounts and VPS sessions',
  'Domain-first onboarding before any new website is created',
  'Availability checks with Namecheap premium-domain support and RDAP fallback',
  'DNS TXT ownership proof before the website builder is unlocked',
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
  'Immutable production-eligibility evidence ties parity, plan, canary and staging together',
  'Final Step 15 admin approval expires and revalidates before any future execution',
  'Production traffic and production cutover remain database-locked through Step 15',
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
  const [selectedDomainIntent, setSelectedDomainIntent] = useState<DomainOnboardingIntent | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    fetch('/api/v2/websites', { credentials: 'include' })
      .then(async response => response.ok ? response.json() : null)
      .then(payload => {
        if (!active) return;
        const websites = Array.isArray(payload?.websites) ? payload.websites : [];
        if (websites.length === 0) setView('domain-onboarding');
      })
      .catch(() => {});
    return () => { active = false; };
  }, [user?.id]);

  if (loading) return <main className="auth-loading">Checking your Site Manager account…</main>;
  if (!user) return <AuthScreen />;

  if (view === 'current-manager') {
    return <div className="v2-legacy-shell"><div className="v2-development-bar"><div><strong>Site Manager V2</strong><span>Development workspace · current domain manager preserved during migration</span></div><button type="button" onClick={() => setView('overview')}>Back to V2 overview</button></div><AppV2 /></div>;
  }

  const openBuilder = (website: WebsiteRecord) => { setBuilderWebsiteId(website.id); setView('builder'); };
  const openPreview = (website: WebsiteRecord) => { setPreviewWebsiteId(website.id); setView('runtime-preview'); };
  const openDomains = (website: WebsiteRecord) => { setDomainWebsiteId(website.id); setView('domains'); };
  const editPreviewedWebsite = () => { if (previewWebsiteId) { setBuilderWebsiteId(previewWebsiteId); setView('builder'); } };
  const startCreateWebsite = () => { setSelectedDomainIntent(null); setView('domain-onboarding'); };
  const continueAfterDomain = (intent: DomainOnboardingIntent) => { setSelectedDomainIntent(intent); setView('create-website'); };

  const pageTitle = view === 'account' ? 'Your account'
    : view === 'my-websites' ? 'My Websites'
      : view === 'domain-onboarding' ? 'Choose Your Domain'
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
                            : view === 'production-eligibility' ? 'Production Eligibility'
                              : 'Site Manager V2';

  const websitesActive = ['my-websites', 'builder', 'runtime-preview'].includes(view);
  const createActive = ['domain-onboarding', 'create-website'].includes(view);

  return <div className="v2-shell">
    <aside className="v2-sidebar">
      <div className="v2-brand"><div className="v2-brand-mark">SM</div><div><strong>Site Manager</strong><small>V2 Development</small></div></div>
      <nav className="v2-nav" aria-label="Site Manager V2 development navigation">
        <button className={view === 'overview' ? 'is-active' : ''} type="button" onClick={() => setView('overview')}>Overview</button>
        <button className={websitesActive ? 'is-active' : ''} type="button" onClick={() => setView('my-websites')}>My Websites</button>
        <button className={createActive ? 'is-active' : ''} type="button" onClick={startCreateWebsite}>Create Website</button>
        <button type="button" disabled>Templates</button>
        <button className={view === 'domains' ? 'is-active' : ''} type="button" onClick={() => setView('domains')}>Domains</button>
        <button className={view === 'deployments' ? 'is-active' : ''} type="button" onClick={() => setView('deployments')}>Deployments</button>
        <button className={view === 'legacy-migration' ? 'is-active' : ''} type="button" onClick={() => setView('legacy-migration')}>Legacy Migration</button>
        <button className={view === 'cutover-readiness' ? 'is-active' : ''} type="button" onClick={() => setView('cutover-readiness')}>Cutover Readiness</button>
        <button className={view === 'cutover-orchestration' ? 'is-active' : ''} type="button" onClick={() => setView('cutover-orchestration')}>Cutover Plans</button>
        <button className={view === 'canary-cutover' ? 'is-active' : ''} type="button" onClick={() => setView('canary-cutover')}>Canary Drill</button>
        <button className={view === 'staging-edge' ? 'is-active' : ''} type="button" onClick={() => setView('staging-edge')}>Staging Edge</button>
        <button className={view === 'production-eligibility' ? 'is-active' : ''} type="button" onClick={() => setView('production-eligibility')}>Production Eligibility</button>
        <button className={view === 'account' ? 'is-active' : ''} type="button" onClick={() => setView('account')}>Account</button>
      </nav>
      <div className="v2-sidebar-footer"><span className="v2-status-dot" />Netlify deployment paused</div>
    </aside>

    <main className="v2-main">
      <header className="v2-topbar"><div><p>DEVELOPMENT WORKSPACE</p><h1>{pageTitle}</h1></div><div className="v2-account-chip"><div><strong>{user.display_name || 'Site Manager customer'}</strong><small>{user.email}</small></div><button type="button" onClick={() => void logout()}>Sign out</button></div></header>
      {view === 'account' && <AccountView />}
      {view === 'overview' && <OverviewView onOpenCurrentManager={() => setView('current-manager')} onCreateWebsite={startCreateWebsite} onOpenDomains={() => setView('domains')} onOpenDeployments={() => setView('deployments')} onOpenMigration={() => setView('legacy-migration')} onOpenParity={() => setView('cutover-readiness')} onOpenCutover={() => setView('cutover-orchestration')} onOpenCanary={() => setView('canary-cutover')} onOpenStaging={() => setView('staging-edge')} onOpenEligibility={() => setView('production-eligibility')} />}
      {view === 'my-websites' && <MyWebsitesView onCreateWebsite={startCreateWebsite} onContinueSetup={openBuilder} onPreviewWebsite={openPreview} onManageDomains={openDomains} />}
      {view === 'domain-onboarding' && <DomainFirstOnboardingView onVerified={continueAfterDomain} onCancel={() => setView('my-websites')} />}
      {view === 'create-website' && selectedDomainIntent && <CreateWebsiteView domainOnboardingId={selectedDomainIntent.id} domainHostname={selectedDomainIntent.hostname} onCreated={openBuilder} onCancel={() => setView('domain-onboarding')} />}
      {view === 'create-website' && !selectedDomainIntent && <DomainFirstOnboardingView onVerified={continueAfterDomain} onCancel={() => setView('my-websites')} />}
      {view === 'builder' && builderWebsiteId && <WebsiteBuilderView websiteId={builderWebsiteId} onBack={() => setView('my-websites')} onCompleted={() => setView('my-websites')} />}
      {view === 'runtime-preview' && previewWebsiteId && <RuntimePreviewView websiteId={previewWebsiteId} onBack={() => setView('my-websites')} onEditSetup={editPreviewedWebsite} />}
      {view === 'domains' && <DomainsWorkspace initialWebsiteId={domainWebsiteId} focus="domains" />}
      {view === 'deployments' && <DeploymentsWorkspace initialWebsiteId={domainWebsiteId} />}
      {view === 'legacy-migration' && <LegacyMigrationWorkspace />}
      {view === 'cutover-readiness' && <CutoverReadinessWorkspace />}
      {view === 'cutover-orchestration' && <CutoverOrchestrationWorkspace />}
      {view === 'canary-cutover' && <CanaryCutoverWorkspace />}
      {view === 'staging-edge' && <StagingEdgeWorkspace />}
      {view === 'production-eligibility' && <ProductionEligibilityWorkspace />}
    </main>
  </div>;
}

function AccountView() {
  const { user } = useAuth();
  if (!user) return null;
  return <>
    <section className="v2-hero-card"><div><p className="v2-kicker">STEP 15 · PRODUCTION ELIGIBILITY + FINAL APPROVAL</p><h2>Production readiness is now a short-lived, immutable evidence state rather than a loose operator decision.</h2><p>Step 15 binds current parity, the armed cutover plan, passed canary, fresh real staging rehearsal, exact held nnn SHA, hostname, V2 fingerprint and rollback evidence. Final approval records authorization, but execution remains unavailable.</p></div></section>
    <section className="v2-grid">
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">EMAIL</span><h3>{user.email}</h3></div><span className="v2-state good">VERIFIED</span></div><p>Email verification protects the customer control plane.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">NEW SITE ONBOARDING</span><h3>Domain first</h3></div><span className="v2-state good">ENFORCED</span></div><p>New sites cannot be created until the intended custom domain has been checked, acquired and ownership-verified.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">FINAL APPROVAL</span><h3>Evidence-bound</h3></div><span className="v2-state good">ADMIN ONLY</span></div><p>Approval expires and becomes invalid if staging evidence, configuration, source or runtime evidence stops matching.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">PAYMENT</span><h3>Designed later</h3></div><span className="v2-state">DEFERRED</span></div><p>No checkout, trial clock or payment gate participates in production eligibility.</p></article>
    </section>
    <section className="v2-next-step"><div><p>NEXT MILESTONE</p><h2>One-site production execution adapter with automatic rollback</h2><span>Step 16 will be the first milestone allowed to design a real production route switch. It must consume a current Step 15 APPROVED record, revalidate it at execution time, move only one migrated site, health-check the exact shared nnn runtime and automatically restore the frozen legacy route on failure.</span></div><div className="v2-step-number">16</div></section>
  </>;
}

function OverviewView({ onOpenCurrentManager, onCreateWebsite, onOpenDomains, onOpenDeployments, onOpenMigration, onOpenParity, onOpenCutover, onOpenCanary, onOpenStaging, onOpenEligibility }: { onOpenCurrentManager: () => void; onCreateWebsite: () => void; onOpenDomains: () => void; onOpenDeployments: () => void; onOpenMigration: () => void; onOpenParity: () => void; onOpenCutover: () => void; onOpenCanary: () => void; onOpenStaging: () => void; onOpenEligibility: () => void }) {
  return <>
    <section className="v2-hero-card"><div><p className="v2-kicker">DOMAIN-FIRST CUSTOMER ONBOARDING + STEP 15 OPERATIONS</p><h2>New customers secure the domain before Site Manager lets them spend time configuring a website.</h2><p>The first-site journey now checks availability, flags premium domains when Namecheap data is available, sends the customer to the registrar for the live price/purchase, verifies ownership through DNS TXT, and only then creates the website. Existing migration/cutover controls remain unchanged.</p></div><div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button className="v2-primary-button" type="button" onClick={onCreateWebsite}>Find domain & create site</button><button className="v2-primary-button" type="button" onClick={onOpenEligibility}>Open production eligibility</button><button className="v2-primary-button" type="button" onClick={onOpenStaging}>Open staging edge</button><button className="v2-primary-button" type="button" onClick={onOpenCanary}>Open canary drill</button><button className="v2-primary-button" type="button" onClick={onOpenCutover}>Open cutover plans</button><button className="v2-primary-button" type="button" onClick={onOpenParity}>Open readiness</button><button className="v2-primary-button" type="button" onClick={onOpenMigration}>Open migration</button><button className="v2-primary-button" type="button" onClick={onOpenDomains}>Open domains</button><button className="v2-primary-button" type="button" onClick={onOpenDeployments}>Open deployments</button><button className="v2-primary-button" type="button" onClick={onOpenCurrentManager}>Open current manager</button></div></section>
    <section className="v2-grid">
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">NEW CUSTOMER</span><h3>Domain first</h3></div><span className="v2-state good">HARD GATE</span></div><p>Website creation consumes a verified domain record, so the API cannot bypass the onboarding screen.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">EVIDENCE</span><h3>Immutable</h3></div><span className="v2-state good">STEP 15</span></div><p>The exact source, held nnn SHA, V2 fingerprint, hostname, upstream run IDs and rollback snapshot are frozen.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">FRESHNESS</span><h3>Short lived</h3></div><span className="v2-state good">RECHECKED</span></div><p>Old staging evidence or changed source/configuration invalidates eligibility instead of carrying approval forward.</p></article>
      <article className="v2-card"><div className="v2-card-head"><div><span className="v2-card-label">PRODUCTION</span><h3>Still unchanged</h3></div><span className="v2-state good">LOCKED</span></div><p>The Step 15 API has an explicit execute route only to return 409 and record that execution was blocked.</p></article>
    </section>
    <section className="v2-section"><div className="v2-section-heading"><div><p>FOUNDATION</p><h2>What is working now</h2></div></div><div className="v2-capability-grid">{capabilities.map(item => <div className="v2-capability" key={item}><span>✓</span><strong>{item}</strong></div>)}</div></section>
    <section className="v2-next-step"><div><p>NEXT MILESTONE</p><h2>One-site production execution adapter with automatic rollback</h2><span>Step 16 will be the first execution milestone. It must require a current Step 15 APPROVED record and preserve a hard one-site-at-a-time production lock, immediate HTTPS/runtime verification, a rollback window and automatic restoration of the legacy route on failure.</span></div><div className="v2-step-number">16</div></section>
  </>;
}
