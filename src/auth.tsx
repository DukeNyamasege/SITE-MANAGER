import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import './auth.css';

export type AuthUser = {
  id: string;
  email: string;
  display_name: string;
  email_verified: boolean;
  status: string;
  created_at: string;
};

type AuthResponse = {
  ok?: boolean;
  user?: AuthUser;
  message?: string;
  code?: string;
  verification_required?: boolean;
  development_verification_url?: string;
  development_reset_url?: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

class AuthApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, payload: AuthResponse) {
    super(payload.message || 'Account request failed.');
    this.status = status;
    this.code = payload.code;
  }
}

async function authRequest(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/v2/auth/${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  let payload: AuthResponse = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new AuthApiError(response.status, payload);
  return payload;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const result = await authRequest('session');
      setUser(result.user || null);
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 401) setUser(null);
      else throw error;
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    refresh()
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  const logout = useCallback(async () => {
    try { await authRequest('logout', { method: 'POST', body: '{}' }); }
    finally { setUser(null); }
  }, []);

  const value = useMemo(() => ({ user, loading, refresh, setUser, logout }), [user, loading, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}

type Mode = 'login' | 'register' | 'forgot' | 'reset' | 'verify';

function initialMode(): Mode {
  const params = new URLSearchParams(window.location.search);
  if (params.get('verify_token')) return 'verify';
  if (params.get('reset_token')) return 'reset';
  return 'login';
}

function clearAccountTokenFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('verify_token');
  url.searchParams.delete('reset_token');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

export function AuthScreen() {
  const { setUser } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [developmentLink, setDevelopmentLink] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);

  const resetFeedback = () => {
    setError('');
    setMessage('');
    setDevelopmentLink('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    resetFeedback();
    setBusy(true);
    try {
      if (mode === 'login') {
        const result = await authRequest('login', { method: 'POST', body: JSON.stringify({ email, password }) });
        setUser(result.user || null);
      } else if (mode === 'register') {
        if (password !== confirmPassword) throw new Error('Passwords do not match.');
        const result = await authRequest('register', {
          method: 'POST',
          body: JSON.stringify({ email, password, display_name: displayName }),
        });
        setMessage(result.message || 'Account created. Check your email to verify it.');
        setDevelopmentLink(result.development_verification_url || '');
        setNeedsVerification(true);
      } else if (mode === 'forgot') {
        const result = await authRequest('forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
        setMessage(result.message || 'If an eligible account exists, reset instructions have been sent.');
        setDevelopmentLink(result.development_reset_url || '');
      } else if (mode === 'verify') {
        const token = new URLSearchParams(window.location.search).get('verify_token') || '';
        const result = await authRequest('verify-email', { method: 'POST', body: JSON.stringify({ token }) });
        clearAccountTokenFromUrl();
        setUser(result.user || null);
      } else if (mode === 'reset') {
        if (password !== confirmPassword) throw new Error('Passwords do not match.');
        const token = new URLSearchParams(window.location.search).get('reset_token') || '';
        const result = await authRequest('reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
        clearAccountTokenFromUrl();
        setUser(result.user || null);
      }
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      setError(messageText);
      setNeedsVerification(err instanceof AuthApiError && err.code === 'EMAIL_NOT_VERIFIED');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    resetFeedback();
    setBusy(true);
    try {
      const result = await authRequest('resend-verification', { method: 'POST', body: JSON.stringify({ email }) });
      setMessage(result.message || 'Verification email sent if required.');
      setDevelopmentLink(result.development_verification_url || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'register' ? 'Create your account'
    : mode === 'forgot' ? 'Reset your password'
      : mode === 'reset' ? 'Choose a new password'
        : mode === 'verify' ? 'Verify your email'
          : 'Welcome back';

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-brand"><span>SM</span><div><strong>Site Manager</strong><small>Website platform</small></div></div>
        <div className="auth-copy">
          <p className="auth-eyebrow">SITE MANAGER V2</p>
          <h1>{title}</h1>
          <p>
            {mode === 'register'
              ? 'Start with an account. Your websites, domains, deployments and subscriptions will belong to you.'
              : mode === 'verify'
                ? 'Confirm that this email address belongs to you before entering the platform.'
                : mode === 'reset'
                  ? 'Set a new secure password. Existing sessions will be revoked.'
                  : 'Sign in to manage your websites and continue building.'}
          </p>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === 'register' && (
            <label>Display name<input value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="name" placeholder="Your name or business" /></label>
          )}
          {!['verify', 'reset'].includes(mode) && (
            <label>Email address<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required placeholder="you@example.com" /></label>
          )}
          {['login', 'register', 'reset'].includes(mode) && (
            <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={10} /></label>
          )}
          {['register', 'reset'].includes(mode) && (
            <label>Confirm password<input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" required minLength={10} /></label>
          )}

          {error && <div className="auth-alert error">{error}</div>}
          {message && <div className="auth-alert success">{message}</div>}
          {developmentLink && <a className="auth-dev-link" href={developmentLink}>Open development email link</a>}

          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Save new password' : mode === 'verify' ? 'Verify email' : 'Sign in'}
          </button>

          {needsVerification && email && <button className="auth-text-button" type="button" disabled={busy} onClick={() => void resend()}>Resend verification email</button>}
        </form>

        <div className="auth-switches">
          {mode !== 'login' && !['verify', 'reset'].includes(mode) && <button type="button" onClick={() => { resetFeedback(); setMode('login'); }}>Back to sign in</button>}
          {mode === 'login' && <><button type="button" onClick={() => { resetFeedback(); setMode('register'); }}>Create an account</button><button type="button" onClick={() => { resetFeedback(); setMode('forgot'); }}>Forgot password?</button></>}
        </div>
      </section>
      <aside className="auth-side">
        <span className="auth-side-badge">VPS PLATFORM</span>
        <h2>One account. Multiple websites.</h2>
        <p>The account foundation being built here will own every site you create, its domain, deployment history and its individual monthly subscription.</p>
        <div className="auth-side-stat"><strong>$10</strong><span>planned monthly billing per active website</span></div>
      </aside>
    </main>
  );
}
