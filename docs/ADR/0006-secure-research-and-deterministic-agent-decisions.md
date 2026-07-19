# ADR 0006: Secure research and deterministic agent decisions

- Status: Accepted
- Date: 2026-07-19

## Context

Public-web research introduces SSRF, DNS-rebinding, prompt-injection, provenance, cost, and non-deterministic decision risks. Lead merging and scoring also affect durable CRM state and cannot depend on an opaque model response alone.

## Decision

- Search and fetch are replaceable provider ports.
- The secure fetcher validates all resolved addresses, denies private and reserved networks, pins an approved address while preserving the original Host header and TLS SNI, revalidates redirects, applies a fail-closed robots policy, accepts only bounded text documents, and strips active content.
- Source snapshots are content-addressed and immutable; evidence preserves the source relationship.
- Regional Scout, Entity Resolver, and ICP Assessor are focused Agents SDK adapters with Zod structured output and no state-changing tools.
- Runtime model selection is explicit configuration rather than a hard-coded default.
- Entity resolution, canonical-key deduplication, rubric totals, hard exclusions, confidence overrides, and the resulting CRM action are recomputed deterministically.
- Research requires environment configuration, a database feature flag, and inactive kill switches.

The implementation follows the official [Agents SDK quickstart](https://developers.openai.com/api/docs/guides/agents/quickstart), [agent definition guidance](https://developers.openai.com/api/docs/guides/agents/define-agents), and [tool guidance](https://openai.github.io/openai-agents-js/guides/tools/).

## Consequences

- Public research fails closed when network safety or robots policy cannot be established.
- Changed public content creates a new snapshot instead of silently overwriting evidence.
- Scores and agent executions are auditable; lead scores are append-only.
- Deterministic CI uses fixtures and does not require network access or an OpenAI secret.
- Live provider validation is a separately approved environment check.
