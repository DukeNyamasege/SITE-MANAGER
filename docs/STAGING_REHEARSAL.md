# Step 9 — isolated staging and end-to-end cutover rehearsal

Step 9 proves the Site Manager control plane and the held `nnn` runtime integration together without changing production `nnn/main` or a real production VPS.

## Production boundary

- `DukeNyamasege/nnn/main` remains the current production source for existing subsites.
- Site Manager/VPS runtime integration remains on draft PR #48.
- Step 9 template changes are developed through child PRs whose base is the hold branch, never production main.
- Site Manager Netlify deployment remains frozen.
- Billing/payment is not part of this rehearsal.

## Automated rehearsal

CI checks out the exact non-production `nnn` staging branch, builds it and validates the built `dist/site-manager-runtime.json` artifact. The artifact must declare publishing contract version 2 and rehearsal contract version 1.

Then `scripts/rehearse-staging.mjs` starts a real Site Manager API process against PostgreSQL and performs:

1. health check,
2. account registration,
3. email verification and session creation,
4. website ownership creation,
5. identity configuration,
6. appearance configuration,
7. feature/navigation configuration,
8. Deriv Client/App configuration,
9. builder completion,
10. VPS logo upload and asset serving,
11. private preview-session creation,
12. preview runtime verification,
13. preview approval,
14. platform hostname reservation,
15. technical readiness verification,
16. plan-mode publish,
17. generated shared-`nnn` Caddy route verification,
18. simulated external DNS/TLS/Caddy activation boundary,
19. live hostname runtime verification, and
20. deployment history/release verification.

The simulation is intentionally limited to infrastructure facts that cannot exist inside a GitHub Actions runner: public DNS propagation, public certificate issuance and a real Caddy reload. Before and after that boundary the rehearsal uses the real Site Manager API, PostgreSQL schema, publisher output and `nnn` artifact contract.

## Legacy regression gate

The held `nnn` branch separately validates the incident that previously took existing subsites down. If `/api/v2/runtime/*` resolves to the legacy SPA HTML document rather than JSON, the future runtime treats that as “Site Manager API not installed here yet” and falls back to the existing static site registry/configuration. A valid JSON response with an incompatible managed deployment contract still fails closed.

## Rehearsal report

Every successful CI run emits a JSON report containing the Site Manager service identity, exact `nnn` source SHA, runtime contract versions, rehearsal website/site key/hostname and every passed checkpoint. The report is uploaded as a GitHub Actions artifact for each Node version.

## Real staging VPS

The Step 8 VPS package is the host package for a future isolated staging machine. On a staging host we will use staging-only manager/preview/platform domains and the held `nnn` integration commit, while keeping customer publishing in `plan` until DNS/Caddy rehearsal is intentionally enabled.

Step 9 does not authorize production cutover. Production `nnn/main`, current customer subsites and the real production VPS remain outside this step.
