# Phase 5 verification

## Automated acceptance

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm db:migrate:check
```

The suite verifies:

- IANA-timezone scheduling across a DST boundary and weekend;
- stable workflow and outbound idempotency identifiers;
- AES-256-GCM refresh-token round trips and tamper rejection;
- RFC MIME, base64url encoding, thread headers and header-injection rejection;
- mandatory InnovatEats website and reply-based opt-out;
- closed production and sandbox gates;
- all six migrations on a new database;
- append-only Gmail grants, suppression, approvals, send attempts and audit records;
- rejection of a suppressed sequence;
- immutable outbound association and invalid delivery transitions;
- web/worker production builds.

## Local dry-run acceptance

1. Keep `.env` at `GMAIL_DELIVERY_MODE=dry_run`, `GLOBAL_DRY_RUN=true` and
   `EMAIL_SEND_ENABLED=false`.
2. Start PostgreSQL and Temporal, migrate and seed.
3. Create or use a lead with an actionable verified business email.
4. Generate, inspect and approve all three latest message versions.
5. Schedule in a valid IANA timezone.
6. Confirm three dates fall on Tuesday–Thursday at 09:00–11:30 local time.
7. Start the worker and confirm the outbox becomes processed.
8. Advance Temporal time or wait until due; confirm outbound status becomes `dry_run`.
9. Confirm Gmail contains no message and the lead did not become `contacted`.

## Sandbox acceptance

Sandbox is not part of an automatic test or deployment. When explicitly approved, connect Mateo's
Gmail, open only the sandbox gates from the runbook, and use a synthetic lead. Confirm the delivered
recipient is exactly `maateosanchezt@gmail.com`, the body contains `https://innovateats.com`, and
touches 2/3 retain the Gmail thread. Close the gates immediately after the test.
