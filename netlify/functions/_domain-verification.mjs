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
        ? 'Domain ownership verified by the DNS TXT record.'
        : 'The verification TXT record is visible, but the expected value has not propagated yet.',
    };
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    if (['ENODATA', 'ENOTFOUND', 'ESERVFAIL', 'ETIMEOUT'].includes(code)) {
      return {
        verified: false,
        method: 'dns-txt',
        record,
        message: 'The verification TXT record is not visible yet. Add it at your DNS provider, wait for propagation, then check again.',
      };
    }
    return {
      verified: false,
      method: 'dns-txt',
      record,
      message: error instanceof Error ? error.message : 'Could not verify the DNS TXT record.',
    };
  }
};

export const checkDomainOwnership = async event => {
  const session = requireProvisioningSession(event);
  return verifyWithDnsTxt(session.domain);
};
