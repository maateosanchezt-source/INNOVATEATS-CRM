# ADR 0008: Evidence-backed message versions and human approval

- Status: Accepted
- Date: 2026-07-19

## Context

High-quality personalization can still create sender-reputation and factuality risk. A fluent draft is not proof that a claim is supported, that the opportunity is specific to the lead, or that Mateo approved the exact text that will later be scheduled.

Editing a draft in place would also destroy the audit trail between generated copy, human changes, reviewer results, and the approved version.

## Decision

- Represent strategy as a typed brief containing diagnosis inputs, a specific opportunity, execution timing, selected Mateo credentials, language, contact, and active evidence IDs.
- Allow at most two credentials and deterministically reject credentials that do not fit the opportunity type.
- Generate exactly three email drafts: initial, day-4 follow-up, and day-10 close-loop.
- Enforce subject and body word ranges, one call CTA, qualified inferences, specificity tokens, and `https://innovateats.com` in every email.
- Map every factual span to active evidence from the same lead. Non-factual spans cannot borrow evidence IDs.
- Run deterministic factuality, specificity, and sales-quality review before persistence.
- Store strategy briefs and message drafts as immutable rows. Human edits create a new version that supersedes exactly one previous version.
- Store approval or rejection as a separate append-only decision on one exact draft version.
- Permit decisions only on the latest QA-passed version. A rejected version must be superseded before it can be reconsidered.
- Require the environment flag, database feature flag, and kill-switch checks before generation.
- Keep scheduling and sending unavailable in Phase 4.

## Consequences

- An approved message can be traced to one contact, strategy brief, evidence set, QA result, and exact body.
- A later edit cannot inherit approval from an older version.
- PostgreSQL independently rejects missing website attribution, cross-lead evidence, invalid version lineage, stale-version approval, updates, and physical deletion.
- Human review remains the authority for outbound copy.
- Phase 5 can schedule only the current approved versions rather than mutable draft content.
