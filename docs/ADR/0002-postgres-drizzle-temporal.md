# ADR 0002: PostgreSQL, Drizzle, and Temporal

- Status: accepted for Phase 0
- Date: 2026-07-19

## Decision

PostgreSQL is the source of truth. Drizzle supplies typed schema and queries while migrations remain reviewable SQL. Temporal owns durable timers, retries, cancellation, and workflow signals.

## Rationale

- Explicit SQL makes constraints, append-only enforcement, and idempotency reviewable.
- PostgreSQL transactions protect state transitions.
- Temporal prevents follow-up scheduling from depending on process memory or `setTimeout`.

## Boundaries

- Temporal history is not the business source of truth.
- Workflows orchestrate; activities perform I/O.
- Agent output never directly mutates critical or terminal state.
- External actions require application-level idempotency in addition to workflow retry semantics.
