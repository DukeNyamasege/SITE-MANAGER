import { useCallback, useEffect, useState, type FormEvent } from 'react';
import './domain-onboarding.css';

export type DomainOnboardingIntent = {
  id: string;
  hostname: string;
  registrar: 'namecheap' | 'other' | string;
  status: string;
  availability_status: 'unknown' | 'available' | 'registered' | string;
  availability_source: string;
  is_premium: boolean | null;
  premium_registration_price: number | null;
  premium_renewal_price: number | null;
  price_currency: string | null;
  price_note?: string | null;
  purchase_status: string;
  ownership_status: string;
  purchase_url: string;
  verification_record: null | {
    type: 'TXT';
    name: string;
    provider_host: string;
    value: string;
  };
  ownership_verified_at?: string | null;
  claimed_website_id?: string | null;
};

type DomainResponse = {
  intent?: DomainOnboardingIntent;
  intents?: DomainOnboardingIntent[];
  verified?: boolean;
  message?: string;
  requires_domain_first?: boolean;
  namecheap_api_enabled?: boolean;
};

async function domainRequest(path = '', options: RequestInit = {}) {
  const response = await fetch(`/api/v2/domain-onboarding${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let payload: DomainResponse = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(payload.message || 'Domain onboarding request failed.');
  return payload;
}

function price(value: number | null, currency: string | null) {
  if (value == null || !currency) return '';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value); }
  catch { return `${currency} ${value.toLocaleString()}`; }
}

function statusCopy(intent: DomainOnboardingIntent) {
  if (intent.availability_status === 'available') return intent.is_premium
    ? 'Available, but this is a premium domain. Review the price carefully before buying.'
    : 'Available. Check the registrar price and buy it before continuing.';
  if (intent.availability_status === 'registered') return 'Already registered. If it is not yours, choose another domain. If you own it, prove ownership and continue.';
  return 'Automatic availability could not be confirmed. Open the registrar result to check the live price/status before continuing.';
}

export function DomainFirstOnboardingView({
  onVerified,
  onCancel,
}: {
  onVerified: (intent: DomainOnboardingIntent) => void;
  onCancel?: () => void;
}) {
  const [domain, setDomain] = useState('');
  const [registrar, setRegistrar] = useState<'namecheap' | 'other'>('namecheap');
  const [intent, setIntent] = useState<DomainOnboardingIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [namecheapApiEnabled, setNamecheapApiEnabled] = useState(false);

  const loadExisting = useCallback(async () => {
    const payload = await domainRequest();
    setNamecheapApiEnabled(Boolean(payload.namecheap_api_enabled));
    const latest = (payload.intents || []).find(item => !item.claimed_website_id && item.ownership_status === 'verified')
      || (payload.intents || []).find(item => !item.claimed_website_id)
      || null;
    if (latest) {
      setIntent(latest);
      setDomain(latest.hostname);
      setRegistrar(latest.registrar === 'other' ? 'other' : 'namecheap');
    }
  }, []);

  useEffect(() => { loadExisting().catch(() => {}); }, [loadExisting]);

  const run = async (work: () => Promise<DomainResponse>, success = '') => {
    setBusy(true); setError(''); setMessage('');
    try {
      const payload = await work();
      if (payload.intent) setIntent(payload.intent);
      if (success) setMessage(success);
      if (payload.message) setMessage(payload.message);
      return payload;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally { setBusy(false); }
  };

  const search = async (event: FormEvent) => {
    event.preventDefault();
    const hostname = domain.trim().toLowerCase();
    if (!hostname) return;
    await run(() => domainRequest('/check', {
      method: 'POST',
      body: JSON.stringify({ hostname, registrar }),
    }));
  };

  const confirmPurchase = async (alreadyOwned: boolean) => {
    if (!intent) return;
    await run(() => domainRequest(`/${encodeURIComponent(intent.id)}/purchase-confirmed`, {
      method: 'POST',
      body: JSON.stringify({ already_owned: alreadyOwned }),
    }), alreadyOwned ? 'Ownership proof is now ready.' : 'Purchase recorded. Add the ownership TXT record next.');
  };

  const checkOwnership = async () => {
    if (!intent) return;
    await run(() => domainRequest(`/${encodeURIComponent(intent.id)}/check-ownership`, { method: 'POST', body: '{}' }));
  };

  const verified = intent?.ownership_status === 'verified' && !intent.claimed_website_id;
  const premiumRegistration = intent ? price(intent.premium_registration_price, intent.price_currency) : '';
  const premiumRenewal = intent ? price(intent.premium_renewal_price, intent.price_currency) : '';

  return <div className="domain-first-page">
    <section className="domain-first-hero">
      <div><p>DOMAIN FIRST · STEP 1</p><h2>Secure your website name before we build anything.</h2><span>Check whether the domain is available and affordable. Buy it first, prove that you own it, then Site Manager unlocks the website builder.</span></div>
      <div className="domain-first-flow"><span className="active">1 Domain</span><span>2 Website</span><span>3 Deriv</span><span>4 Preview</span><span>5 DNS</span><span>6 Publish</span></div>
    </section>

    {error && <div className="domain-first-alert error">{error}</div>}
    {message && <div className="domain-first-alert success">{message}</div>}

    <section className="domain-first-card">
      <div className="domain-first-heading"><span>FIND YOUR DOMAIN</span><h3>What address do you want?</h3><p>Example: <strong>duke.site</strong>. Do this before choosing colors, bots, branding or Deriv settings.</p></div>
      <form className="domain-search" onSubmit={search}>
        <input value={domain} onChange={event => { setDomain(event.target.value); setIntent(null); }} placeholder="duke.site" autoCapitalize="none" autoCorrect="off" required />
        <button className="v2-primary-button" disabled={busy} type="submit">{busy ? 'Checking…' : 'Check domain'}</button>
      </form>
      <div className="registrar-choice">
        <span>Where will you buy/manage it?</span>
        <label><input type="radio" checked={registrar === 'namecheap'} onChange={() => setRegistrar('namecheap')} /> Namecheap</label>
        <label><input type="radio" checked={registrar === 'other'} onChange={() => setRegistrar('other')} /> Another registrar</label>
      </div>
      <p className="domain-source-note">{namecheapApiEnabled ? 'Site Manager is connected to Namecheap availability data.' : 'Availability uses the public domain registry when Namecheap API credentials are not installed. The registrar checkout remains the final source for current price.'}</p>
    </section>

    {intent && <section className={`domain-result ${intent.availability_status} ${intent.is_premium ? 'premium' : ''}`}>
      <div className="domain-result-title"><div><span>DOMAIN RESULT</span><h2>{intent.hostname}</h2></div><strong>{intent.availability_status === 'available' ? 'AVAILABLE' : intent.availability_status === 'registered' ? 'TAKEN / REGISTERED' : 'CHECK REGISTRAR'}</strong></div>
      <p>{statusCopy(intent)}</p>
      <div className="domain-result-grid">
        <div><span>Availability source</span><strong>{intent.availability_source}</strong></div>
        <div><span>Premium domain</span><strong>{intent.is_premium == null ? 'Unknown — confirm at checkout' : intent.is_premium ? 'YES' : 'No'}</strong></div>
        <div><span>Registration price</span><strong>{premiumRegistration || (intent.availability_status === 'available' ? 'See live registrar checkout' : '—')}</strong></div>
        <div><span>Renewal price</span><strong>{premiumRenewal || (intent.availability_status === 'available' ? 'See live registrar checkout' : '—')}</strong></div>
      </div>
      {intent.price_note && <div className="domain-price-note">{intent.price_note}</div>}

      {intent.purchase_status !== 'confirmed' && <div className="domain-buy-actions">
        <a className="domain-buy-button" href={intent.purchase_url} target="_blank" rel="noreferrer">Check price & buy on Namecheap ↗</a>
        {intent.availability_status === 'available' && <button type="button" disabled={busy} onClick={() => void confirmPurchase(false)}>I purchased this domain</button>}
        <button type="button" disabled={busy} onClick={() => void confirmPurchase(true)}>I already own this domain</button>
        <button type="button" onClick={() => { setIntent(null); setDomain(''); }}>Choose another domain</button>
      </div>}
    </section>}

    {intent?.purchase_status === 'confirmed' && intent.verification_record && intent.ownership_status !== 'verified' && <section className="domain-first-card ownership-card">
      <div className="domain-first-heading"><span>PROVE OWNERSHIP</span><h3>Add one TXT record.</h3><p>If you use Namecheap: <strong>Domain List → Manage → Advanced DNS → Add New Record → TXT Record</strong>.</p></div>
      <div className="dns-copy-grid">
        <div><span>Type</span><strong>TXT</strong></div>
        <div><span>Namecheap Host</span><strong>{intent.verification_record.provider_host}</strong><button type="button" onClick={() => navigator.clipboard.writeText(intent.verification_record!.provider_host)}>Copy</button></div>
        <div><span>Value</span><strong>{intent.verification_record.value}</strong><button type="button" onClick={() => navigator.clipboard.writeText(intent.verification_record!.value)}>Copy</button></div>
      </div>
      <p className="domain-source-note">Do not point the domain to the VPS yet. This TXT record only proves that the domain belongs to you. The A/CNAME routing step comes later after your website is configured and previewed.</p>
      <button className="v2-primary-button" disabled={busy} type="button" onClick={() => void checkOwnership()}>{busy ? 'Checking DNS…' : 'I added the TXT record — verify ownership'}</button>
    </section>}

    {verified && intent && <section className="domain-verified-card">
      <div><span>✓ DOMAIN VERIFIED</span><h2>{intent.hostname} is yours.</h2><p>The risky part is finished before website setup. Site Manager will attach this domain automatically when the website is created.</p></div>
      <button className="v2-primary-button" type="button" onClick={() => onVerified(intent)}>Continue to website setup →</button>
    </section>}

    {onCancel && <button className="domain-cancel" type="button" onClick={onCancel}>Back to My Websites</button>}
  </div>;
}
