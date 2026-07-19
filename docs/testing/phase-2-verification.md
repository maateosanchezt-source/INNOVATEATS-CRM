# Phase 2 verification

## Automated gate

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm db:migrate:check
```

The gate covers:

- twenty synthetic discovery candidates that resolve to seventeen unique leads and three duplicates;
- deterministic ICP totals, explanations, hard exclusions, low-confidence overrides, and action thresholds;
- the `0.85` entity-resolution review gate;
- secure-fetch public-address validation, address pinning, unsafe redirects, robots denial, active-content removal, and snapshot hashing;
- append-only lead scores and constrained agent-run lifecycle;
- research-policy denial before any network call;
- empty-database execution of every migration.

## Environment checks

1. Apply the migrations to a disposable PostgreSQL database.
2. Run the seed twice and confirm it remains idempotent.
3. Open the Northstar synthetic lead and verify the stored ICP score, dimension explanations, evidence references, and missing-information list.
4. With research disabled, submit a research request and confirm a `409` response with no network call.
5. In a controlled environment, enable both research gates and fetch a public host you control. Confirm a second identical fetch reuses the content-addressed snapshot.

## Live model check

A live OpenAI check requires a secret API key and an explicit `OPENAI_RESEARCH_MODEL`. It is intentionally excluded from deterministic CI. The research agents receive delimited untrusted text and have no send, merge, pipeline-transition, or other state-changing tools.
