import './maintenance.css';

export default function MaintenancePage() {
  return (
    <main className="maintenance-page">
      <section className="maintenance-card" aria-labelledby="maintenance-title">
        <div className="maintenance-badge">SITE MANAGER</div>
        <div className="maintenance-icon" aria-hidden="true">⚙</div>
        <p className="maintenance-eyebrow">UNDER DEVELOPMENT</p>
        <h1 id="maintenance-title">We’ll be back soon.</h1>
        <p className="maintenance-copy">
          Site Manager is currently being upgraded. Thank you for your patience while we build a better experience.
        </p>
        <div className="maintenance-status">
          <span className="maintenance-dot" aria-hidden="true" />
          Development in progress
        </div>
        <p className="maintenance-thanks">Thank you for waiting.</p>
      </section>
    </main>
  );
}
