# Threat model

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

| Threat              | Baseline control                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Unauthorized user   | Exact Google email allowlist; server-side session checks                                                                               |
| Prompt injection    | External content is data; fixed tools; strict schemas                                                                                  |
| SSRF/DNS rebinding  | Resolve every address, deny non-public ranges, pin the approved address, preserve Host/SNI, and revalidate every redirect              |
| Hostile web content | Content is inert data; scripts/styles are removed; agent prompts delimit untrusted input; research agents have no state-changing tools |
| Robots/rate abuse   | Fail-closed robots policy, bounded fetches, explicit user agent, and provider-level throttling                                         |
| Duplicate send      | Unique idempotency key plus transactional outbox                                                                                       |
| Send after reply    | Temporal signal plus pre-send database check                                                                                           |
| Suppression bypass  | Checks at approval, scheduling, and send                                                                                               |
| Audit tampering     | Database trigger denies update/delete                                                                                                  |
| Secret leakage      | Environment-only secrets and structured log redaction                                                                                  |
| Cost loop           | Daily/per-lead budgets and hard pause                                                                                                  |
| Policy regression   | Versioned fixtures and fail-closed resolution                                                                                          |

## Phase 2 boundary

Research can fetch public content and can call a configured OpenAI model. It cannot access Gmail, send email, mutate pipeline state through an agent tool, or bypass deterministic entity and scoring gates. Research is off by default and additionally controlled by database flags and kill switches.
