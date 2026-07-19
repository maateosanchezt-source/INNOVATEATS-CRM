# Phase 8 verification

The Phase 8 gate includes:

- 100 synthetic lead fixtures: 30 strong, 20 borderline, 20 hard exclusions, 10 duplicates, 10
  injection attempts and 10 ambiguous contacts;
- 50 regional policy decisions and golden cases A-J;
- strict threshold handling for bounce rate below 3% and reply stop below 60 seconds;
- migration tests for immutable prompts/evals, the pilot envelope, review checkpoints, checklist
  evidence and exact seven-part human quality averages;
- runtime tests proving production remains inside the explicit human-approved pilot;
- authenticated metrics for funnel, quality, deliverability and cost;
- authenticated JSON export and guarded active-PII anonymization.

Commands:

```text
pnpm check
pnpm db:migrate:check
```

Remote merge requires exact GitHub checks `quality` and `migrations`. Passing them does not enable
production or certify external pilot evidence.
