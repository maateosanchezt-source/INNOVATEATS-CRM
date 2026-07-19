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

| Threat               | Baseline control                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Unauthorized user    | Exact Google email allowlist; server-side session checks                                                                               |
| Prompt injection     | External content is data; fixed tools; strict schemas                                                                                  |
| SSRF/DNS rebinding   | Resolve every address, deny non-public ranges, pin the approved address, preserve Host/SNI, and revalidate every redirect              |
| Hostile web content  | Content is inert data; scripts/styles are removed; agent prompts delimit untrusted input; research agents have no state-changing tools |
| Robots/rate abuse    | Fail-closed robots policy, bounded fetches, explicit user agent, and provider-level throttling                                         |
| Fabricated contact   | Deterministic public-link extraction, exact evidence provenance, association trigger, and no inferred-to-verified transition           |
| MX overclaim         | Syntax, MX, and mailbox-provider verdicts are separate statuses; MX alone is never mailbox verification                                |
| Contact reassignment | Immutable contact identity/provenance and database validation against active lead evidence                                             |
| Unsupported copy     | Per-span evidence map, deterministic QA, same-lead database checks, and human approval                                                 |
| Approval drift       | Immutable draft versions; approval binds to one latest QA-passed version                                                               |
| Spam-like sequence   | Three-touch maximum, bounded copy, one low-friction CTA, easy-out close, and website attribution                                       |
| Duplicate send       | Unique idempotency key plus transactional outbox                                                                                       |
| Send after reply     | Temporal signal plus pre-send database check                                                                                           |
| Suppression bypass   | Checks at approval, scheduling, and send                                                                                               |
| Audit tampering      | Database trigger denies update/delete                                                                                                  |
| Secret leakage       | Environment-only secrets and structured log redaction                                                                                  |
| Cost loop            | Daily/per-lead budgets and hard pause                                                                                                  |
| Policy regression    | Versioned fixtures and fail-closed resolution                                                                                          |

## Phase 3 boundary

Research can fetch public content and can call a configured OpenAI model. Contact enrichment can parse stored official snapshots and perform a gated MX lookup. Neither subsystem can access Gmail, send email, mutate terminal state through an agent tool, or bypass deterministic entity, scoring, association, and verification gates. Both are off by default and additionally controlled by database flags and kill switches.

## Phase 4 boundary

Message generation consumes stored contact and evidence state. It can create immutable strategy, draft, QA, version, and approval records, but it cannot schedule work, access Gmail, or send email. Generation is disabled by default and requires environment/database gates plus clear kill switches. Every approved version retains the required InnovatEats website and active same-lead factual evidence.

## Phase 5 boundary

Scheduling creates durable work but does not itself call Gmail. The worker can access the newest
encrypted Gmail grant only after an outbound row is atomically claimed and every current safety
condition passes. Dispatch has one Temporal attempt. An ambiguous result becomes
`delivery_unknown`, stops the sequence, and cannot be automatically retried. Dry run has no external
action; sandbox rewrites the recipient to Mateo; production remains unapproved and closed by
default. Reply classification and automatic bounce/unsubscribe ingestion remain outside this phase.
