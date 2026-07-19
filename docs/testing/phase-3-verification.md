# Phase 3 verification

## Automated gate

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm db:migrate:check
```

The gate covers:

- direct extraction of official mailto, contact-form, LinkedIn, Instagram, and platform routes;
- no fabricated result when a snapshot contains no contact path;
- cross-domain extraction denial;
- normalized contact deduplication;
- syntax, MX, provider, risky, invalid, and DNS-uncertainty outcomes;
- permanent denial of inferred-to-verified promotion;
- database rejection of mismatched organization/evidence/source associations;
- immutable contact identity and append-only verification history;
- disabled-by-default contact gates and scoped kill switches;
- execution of all four migrations from an empty database.

## Manual acceptance

1. Capture a fresh secure snapshot from a controlled canonical brand domain.
2. Extract contact paths and compare every value and direct link with the page.
3. Confirm each contact displays its exact source, provenance, confidence, origin, and verification state.
4. Submit evidence from a different lead and confirm the operation is blocked.
5. Verify a controlled email with `EMAIL_VERIFIER_PROVIDER=disabled`; confirm MX is recorded without claiming mailbox verification.
6. Confirm an inferred fixture cannot be stored or updated as verified.
7. Run the seed twice against disposable PostgreSQL and confirm idempotency.
