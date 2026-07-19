# ADR 0012: Evals, controlled pilot readiness, and data governance

## Status

Accepted for Phase 8. Production remains closed.

## Decision

- Keep a deterministic, versioned dataset of 100 synthetic leads with the required cohort mix and
  all six policy regions.
- Grade lead selection, contact safety, evidence mapping, regional policy, reply handling and
  exactly-once behavior with golden cases A-J.
- Store every evaluation report append-only. `automated_passed` and `pilot_ready` are separate:
  automation can pass while real pilot evidence is absent.
- Store immutable prompt snapshots and route models by task. Every route remains on the strong
  baseline; a missing task model fails closed and no cost downgrade is authorized.
- Represent the initial pilot as a 50-lead, US/UK corporate-only, human-approved plan with a
  10-email daily ceiling, review after each 20 messages, and a maximum 14-day window.
- Enforce the daily and 50-distinct-lead envelope again at the production send gate.
- Store checklist reviews only with human evidence. The application never infers that DNS, legal,
  backup, monitoring, address, or pilot-signature evidence exists.
- Provide authenticated owner export. Provide irreversible active-data anonymization only for
  rejected leads with no sequence; retain immutable evidence, status history and audit records.

## Consequences

A green CI run proves the code and deterministic acceptance suite, not external pilot readiness.
Real delivery cannot be represented as ready until strict bounce and reply-stop thresholds, human
message scores, zero complaints, and Mateo's signed result are recorded. Production also continues
to require every pre-existing safety, compliance, sender, OAuth, suppression and approval gate.
