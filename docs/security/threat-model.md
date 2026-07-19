# Phase 0 threat model

## Assets

- Mateo's authenticated session and OAuth grants.
- Business contact data and suppression identifiers.
- Evidence snapshots and message history.
- Regional policy and approval decisions.
- Sender reputation.
- Append-only audit trail.

## Trust boundaries

- Browser to Next.js control plane.
- Web/worker to PostgreSQL and Temporal.
- Worker to OpenAI, Gmail, search, verifier, storage, and notification providers.
- Public web and inbound email into the research/reply pipeline.

## Primary threats and controls

| Threat             | Baseline control                                                         |
| ------------------ | ------------------------------------------------------------------------ |
| Unauthorized user  | Exact Google email allowlist; server-side session checks                 |
| Prompt injection   | External content is data; fixed tools; strict schemas                    |
| SSRF               | Future secure-fetch adapter denies private networks and unsafe redirects |
| Duplicate send     | Unique idempotency key plus transactional outbox                         |
| Send after reply   | Temporal signal plus pre-send database check                             |
| Suppression bypass | Checks at approval, scheduling, and send                                 |
| Audit tampering    | Database trigger denies update/delete                                    |
| Secret leakage     | Environment-only secrets and structured log redaction                    |
| Cost loop          | Daily/per-lead budgets and hard pause                                    |
| Policy regression  | Versioned fixtures and fail-closed resolution                            |

## Explicitly deferred

Phase 0 does not fetch public content, call OpenAI, access Gmail, or send email.
