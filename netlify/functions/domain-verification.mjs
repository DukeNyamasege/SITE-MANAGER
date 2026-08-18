import { HttpError, errorResponse, json, requireProvisioningSession } from './_lib.mjs';
import { checkDomainOwnership, verificationRecordForDomain } from './_domain-verification.mjs';

export const handler = async event => {
  try {
    const session = requireProvisioningSession(event);

    if (event.httpMethod === 'GET') {
      return json(200, {
        verified: false,
        domain: session.domain,
        method: 'dns-txt',
        record: verificationRecordForDomain(session.domain),
        message: 'Add the TXT record at your DNS provider, then check ownership from the wizard.',
      });
    }

    if (event.httpMethod === 'POST') {
      const result = await checkDomainOwnership(event);
      return json(200, { domain: session.domain, ...result });
    }

    throw new HttpError(405, 'Method not allowed.');
  } catch (error) {
    return errorResponse(error);
  }
};
