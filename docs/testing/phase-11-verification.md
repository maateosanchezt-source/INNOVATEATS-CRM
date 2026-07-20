# Phase 11 verification: Instagram discovery

## Automated acceptance

Run from the repository root:

```text
pnpm check
pnpm db:migrate:check
```

The suite must prove:

- discovery configuration fails closed without an Apify token when enabled;
- handles, campaign limits, seeds, profiles, and workflow input pass Zod boundaries;
- malformed provider rows are discarded and private email fields are not mapped;
- all migrations apply on an empty database;
- discovery source records are append-only;
- completed provider actions cannot be changed;
- candidate decisions cannot be reversed;
- web, worker, workflow, database, integration, and shared packages compile in strict mode.

Before committing, scan the tracked diff for secret prefixes. No Apify or OpenAI credential may
appear in Git, logs, fixtures, screenshots, or documentation.

## Local pilot

1. Keep `GLOBAL_DRY_RUN=true`, `EMAIL_SEND_ENABLED=false`, and
   `AUTONOMOUS_SEND_ENABLED=false`.
2. Set the untracked local environment values:
   `DISCOVERY_ENABLED=true` and `APIFY_API_TOKEN`.
3. Apply migration `0009_instagram_discovery.sql`.
4. Start the local Docker stack and confirm web and worker health.
5. Create one manual Spain campaign with a small target and no automatic schedule.
6. Queue one run and watch its Temporal workflow plus the CRM run ledger.
7. Confirm profiles appear in `/discovery` with provenance-derived track, follower/activity flags,
   and no email field.
8. Record a yes/no decision and confirm a second decision is rejected.
9. Confirm no DM, email, comment, follow, or other Instagram write action occurred.

Do not enable the 500-lead schedule until the owner approves the pilot examples and source quality.
