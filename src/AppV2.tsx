import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from './api';
import ExistingSiteWizard from './ExistingSiteWizard';
import ProvisioningWizard from './ProvisioningWizard';
import type { Domain, DomainsResponse, LoginResponse } from './types';
import './onboarding.css';

function Login({ onSuccess }: { onSuccess: (result: LoginResponse) => Promise<void> }) {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<LoginResponse>('login', {
        method: 'POST',
        body: JSON.stringify({ domain }),
      });
      setDomain('');
      await onSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-shell private-login-shell">
      <section className="login-card private-login-card">
        <div className="brand-mark">SM</div>
        <p className="eyebrow">SITE ACCESS</p>
        <h1>Site Manager</h1>
        <p className="muted">Enter your domain to continue.</p>
        <form onSubmit={submit}>
          <label>
            Domain
            <input
              type="text"
              value={domain}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={event => setDomain(event.target.value.toLowerCase())}
              required
            />
          </label>
          {error && <div className="alert error">{error}</div>}
          <button className="primary-button" disabled={busy || !domain.trim()} type="submit">
            {busy ? 'Opening…' : 'Continue'}
          </button>
        </form>
      </section>
    </main>
  );
}

export default function AppV2() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [site, setSite] = useState<Domain | null>(null);
  const [error, setError] = useState('');

  const loadDomainSession = useCallback(async () => {
    try {
      const payload = await api<DomainsResponse>('domains');
      const current = payload.domains[0] || null;
      setSite(current);
      setOnboarding(Boolean(payload.onboarding));
      setAuthenticated(true);
      setError('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthenticated(false);
        setOnboarding(false);
        setSite(null);
        return;
      }
      setAuthenticated(false);
      setSite(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => { void loadDomainSession(); }, [loadDomainSession]);

  const handleLogin = async (_result: LoginResponse) => {
    await loadDomainSession();
  };

  const logout = async () => {
    try {
      await api('logout', { method: 'POST' });
    } finally {
      setAuthenticated(false);
      setOnboarding(false);
      setSite(null);
      setError('');
    }
  };

  if (authenticated === null) {
    return <main className="loading-shell"><div className="spinner" />Checking domain session…</main>;
  }

  if (!authenticated || !site) {
    return (
      <>
        {error && <div className="alert error global-alert startup-alert">{error}</div>}
        <Login onSuccess={handleLogin} />
      </>
    );
  }

  if (onboarding) {
    return <ProvisioningWizard site={site} onComplete={loadDomainSession} onChangeDomain={logout} />;
  }

  return <ExistingSiteWizard site={site} onChangeDomain={logout} />;
}
