import crypto from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { HttpError, requireProvisioningSession } from './_lib.mjs';

const verificationSecret = () => {
  const secret = process.env.DOMAIN_VERIFICATION_SECRET || process.env.GITHUB_TOKEN;
  if (!secret) throw new HttpError(500, 'DOMAIN_VERIFICATION_SECRET or GITHUB_TOKEN must be configured.');
  return secret;
};

export const verificationRecordForDomain = domain => {
  const token = crypto
    .createHmac('sha256', verificationSecret())
    .update(`site-manager-domain-verification:${domain}`)
    .digest('hex')
    .slice(0, 40);
  return {
    name: `_site-manager-verify.${domain}`,
    host: '_site-manager-verify',
    type: 'TXT',
    value: `site-manager-verification=${token}`,
  };
};

const verifyWithProvisioner = async domain => {
  const url = String(process.env.PROVISIONER_URL || '').replace(/\/$/, '');
  const secret = process.env.PROVISIONER_SECRET;
  if (!url || !secret) return null;

  try {
    const response = await fetch(`${url}/verify-namecheap`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ domain }),
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = { message: text }; }
    }
    if (response.ok && payload?.verified === true) {
      return { verified: true, method: 'namecheap-account', message: 'Domain ownership verified through the connected Namecheap account.' };
    }
    return { verified: false, method: 'namecheap-account', message: payload?.message || 'Domain was not verified in the connected Namecheap account.' };
  } catch (error) {
    console.warn('Namecheap ownership verification unavailable:', error instanceof Error ? error.message : error);
    return null;
  }
};

const verifyWithDnsTxt = async domain => {
  const record = verificationRecordForDomain(domain);
  try {
    const answers = await resolveTxt(record.name);
    const values = answers.map(parts => parts.join(''));
    const verified = values.includes(record.value);
    return {
      verified,
      method: 'dns-txt',
      record,
      message: verified
        ? 'Domain ownership verified by DNS TXT record.'
        : 'The verification TXT record has not propagated yet.',
    };
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    if (['ENODATA', 'ENOTFOUND', 'ESERVFAIL', 'ETIMEOUT'].includes(code)) {
      return { verified: false, method: 'dns-txt', record, message: 'The verification TXT record is not visible yet.' };
    }
    return { verified: false, method: 'dns-txt', record, message: error instanceof Error ? error.message : 'Could not verify the DNS TXT record.' };
  }
};

export const checkDomainOwnership = async event => {
  const session = requireProvisioningSession(event);
  const automatic = await verifyWithProvisioner(session.domain);
  if (automatic?.verified) return automatic;
  const dns = await verifyWithDnsTxt(session.domain);
  if (!dns.verified && automatic?.message) dns.automatic_message = automatic.message;
  return dns;
};
