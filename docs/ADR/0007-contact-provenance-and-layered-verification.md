# ADR 0007: Contact provenance and layered verification

- Status: Accepted
- Date: 2026-07-19

## Context

A guessed or incorrectly associated email can damage sender reputation and contact the wrong person. A valid email format, a domain with MX records, a published address, and a mailbox-provider verdict are different claims and must not be collapsed into one boolean.

## Decision

- Extract direct contact paths only from stored inert snapshots of the canonical organization site.
- Preserve source document, evidence, direct URL, origin, provenance, confidence, and personal-data classification on every contact.
- Validate organization, founder, source-document, and active-evidence association in PostgreSQL.
- Keep contact identity and provenance immutable; allow only audited verification and suppression state changes.
- Store every verification attempt in append-only history.
- Model syntax, MX, publication, provider verification, risk, invalidity, and manual review as distinct states.
- Never promote an inferred pattern to `published_verified` or `provider_verified`.
- Require a named provider for a provider-verified data-broker result.
- Keep contact enrichment behind environment/database gates and kill switches.

## Consequences

- A contact cannot be silently moved to another organization or source.
- MX-only results do not claim mailbox validity.
- Plain-text addresses without an explicit contact link enter manual review.
- The default disabled provider performs no mailbox-level lookup.
- No contact operation sends a message or accesses Gmail.
