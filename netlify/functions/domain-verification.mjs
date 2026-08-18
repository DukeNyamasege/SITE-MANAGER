import { HttpError, errorResponse, json, requireProvisioningSession } from './_lib.mjs';
import { checkDomainOwnership, verificationRecordForDomain } from './_domain-verification.mjs';

export const handler = async event => {
  try {
    const session = requireProvisioningSession(event);

    if (event.httpMethod === 'GET') {
      return json(200, {
        verified: false,
        domain: session.domain,
        record: verificationRecordForDomain(session.domain),
        automatic_namecheap_check: Boolean(process.env.PROVISIONER_URL && process.env.PROVISIONER_SECRET),
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
