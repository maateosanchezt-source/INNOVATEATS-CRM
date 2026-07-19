# ADR 0004: Fail-closed outbound safety

- Status: accepted for Phase 0
- Date: 2026-07-19

## Decision

Outbound capability is fail-closed through independent controls:

1. global dry-run;
2. email feature flag;
3. autonomous-send feature flag;
4. active kill switches;
5. suppression;
6. regional policy;
7. human approval;
8. idempotency;
9. required website validation.

No single setting can enable production outreach.

Every outreach email must contain the exact public URL `https://innovateats.com`. This requirement is a deterministic validator, not a prompt instruction.

During the pilot, `approval_required` overrides the US email `autonomous_allowlist` seed. Autonomy requires a later explicit go-live decision.
