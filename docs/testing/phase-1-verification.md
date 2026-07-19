# Phase 1 verification

Phase 1 acceptance requires:

1. `pnpm install --frozen-lockfile`
2. `pnpm check`
3. `pnpm db:migrate:check`
4. Apply migrations to local PostgreSQL.
5. Run `pnpm db:seed` twice; both runs must succeed.
6. Sign in as the authorized Google identity.
7. Confirm the three clearly labelled synthetic seed leads appear in `/leads`.
8. Submit a public URL twice; the second request must resolve to the first lead.
9. Add, revise, and remove evidence; confirm the timeline and active evidence view update.
10. Attempt an invalid pipeline jump and confirm the API returns `409`.

The CRM must not invoke research, enrichment, message generation, or email providers.
