# Phase 4 verification

## Automated gate

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm db:migrate:check
```

The gate covers:

- 20 golden lead-message fixtures, alternating English and Spanish;
- initial, day-4 follow-up, and day-10 close-loop word ranges;
- 3-8 word initial subjects and exact sequence ordering;
- `https://innovateats.com` in every email;
- factual spans backed only by the lead's allowed evidence IDs;
- qualified opportunities, specific lead tokens, one call CTA, and prohibited-language checks;
- credential-to-opportunity compatibility and a maximum of two credentials;
- environment/database message-generation gates and scoped/global kill switches;
- immutable strategy and message rows with linear version lineage;
- rejection of cross-lead evidence and messages without the required website;
- append-only decisions and rejection of approval on a superseded version;
- execution of all five migrations from an empty database.

## Manual acceptance

1. Put a controlled lead in `contact_found` with one published-verified email and active evidence.
2. Enable `MESSAGE_GENERATION_ENABLED` and the `message_generation_enabled` database flag while keeping global dry run active.
3. Complete diagnosis, opportunity, execution step, opportunity type, Mateo proof, and evidence selection.
4. Generate and inspect all three drafts. Confirm the evidence map and three QA scores are visible.
5. Edit a non-factual sentence without removing specificity tokens or `https://innovateats.com`; confirm a new immutable version and before/after diff appear.
6. Attempt to remove an evidence-backed factual sentence or the required website; confirm the edit is rejected.
7. Reject a version with a reason, edit it, and confirm only the new version can be approved.
8. Approve all three current versions and confirm the UI reports `3/3 approved`.
9. Confirm no schedule, Gmail call, or external send occurs.
