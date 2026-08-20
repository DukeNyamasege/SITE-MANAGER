# Domain-first customer onboarding

Every newly created V2 website must begin with a custom domain. The customer cannot create the website record first and decide on the domain later.

## Customer journey

1. Register and verify the Site Manager account.
2. Search the intended domain before configuring any website details.
3. Site Manager checks availability.
   - When Namecheap API credentials are configured, `namecheap.domains.check` is used and premium registration/renewal prices are surfaced.
   - Otherwise Site Manager uses RDAP for availability and requires the customer to confirm the live registrar price at checkout.
4. If the domain is taken and not owned by the customer, choose another domain.
5. If the domain is available, open the Namecheap purchase page and review the current registration/renewal price before paying.
6. Confirm purchase, or choose `I already own this domain` for a domain that was previously registered by the customer.
7. Add the generated `_site-manager-verify` TXT ownership record at the DNS provider.
8. Site Manager verifies the TXT record.
9. Only then is website creation unlocked.
10. Website creation consumes that verified onboarding record and automatically attaches the hostname as the primary custom domain with ownership already verified.
11. Branding, Deriv setup, preview, routing A/CNAME records, SSL and publishing happen later.

## Security and lifecycle rules

- `POST /api/v2/websites` returns `409 domain_first_required` when no onboarding ID is supplied.
- The onboarding record must belong to the authenticated user.
- Purchase/ownership must be confirmed and TXT ownership must be verified.
- One verified onboarding record can create only one website.
- A hostname already attached to another Site Manager website cannot be onboarded.
- A partial unique index prevents the same hostname from being verified by multiple active accounts.
- Existing/migrated websites are not retroactively blocked.
- DNS ownership verification happens before routing; customers are explicitly told not to point A/CNAME records at the VPS until the later readiness stage.

## Availability provider

Production defaults to:

```env
DOMAIN_AVAILABILITY_MODE=auto
```

`auto` uses Namecheap only when all required credentials are configured. Otherwise it falls back to RDAP.

Optional Namecheap settings:

```env
NAMECHEAP_API_USER=
NAMECHEAP_API_KEY=
NAMECHEAP_USERNAME=
NAMECHEAP_CLIENT_IP=
NAMECHEAP_API_SANDBOX=false
```

Namecheap requires the API client IP to be allowed for the API account. Keep the API key only in `/etc/site-manager/site-manager.env`; it must never be sent to the browser.

For standard domains, the registrar checkout remains the source of truth for the current registration/renewal total. For premium domains, Site Manager displays the premium prices returned by `namecheap.domains.check` and still instructs the customer to confirm the final checkout total before payment.

## New-site state transition

```text
account verified
  -> domain searched
  -> purchase confirmed / already owned
  -> ownership TXT verified
  -> website created
  -> domain attached as primary custom hostname
  -> builder
  -> preview
  -> A/CNAME routing
  -> SSL
  -> publish
```

This change does not alter the migrated-site Step 10-15 production cutover safety model.
