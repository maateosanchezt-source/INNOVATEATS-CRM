# ADR 0014: Controlled, provider-neutral Instagram discovery

## Status

Accepted for Phase 11.

## Context

The highest-value manual bottleneck is finding Spanish founders who are starting food brands or
dropshipping businesses. Instagram is useful for discovery, but an internal CRM must not turn that
need into uncontrolled account automation, secret leakage, repeated paid runs, or untraceable lead
lists.

The system already treats external content as inert evidence and keeps Instagram outreach manual.
Discovery therefore needs a separate read-only boundary and a human decision before a profile can
advance.

## Decision

Use a provider-neutral `ApifyInstagramProvider` behind typed and validated contracts. The initial
configuration uses:

- the official Apify Instagram search actor for public user search;
- the official Apify Instagram profile actor for public profile enrichment;
- a separately configurable community actor for public followers/following sampling.

The community actor is optional and replaceable. Its output is never trusted as an identity claim;
profile enrichment and human review remain required.

Each external action follows this order:

1. persist an immutable action claim and SHA-256 input hash;
2. launch the provider actor once;
3. persist the provider run and dataset identifiers immediately;
4. poll and validate the dataset;
5. complete the action or record a terminal failure/unknown state.

If the launch response is ambiguous, the action becomes `unknown` and execution stops for manual
reconciliation. It is not automatically repeated.

Campaigns enforce a target, rolling daily candidate capacity, results per seed, follower bounds,
recent-activity window, and optional schedule. Scheduling is disabled by default. All candidates
enter `needs_review`; filter failures are visible flags, not silent deletion.

Only the public fields needed for qualification are stored. Email fields exposed by an Instagram
dataset are deliberately discarded. No Instagram login, cookie, password, DM, comment, follow,
like, email send, or browser-profile automation exists in this phase.

## Consequences

- Provider cost and execution are bounded and traceable.
- Duplicate profiles are resolved within a campaign while every discovery source remains
  append-only.
- Human decisions are one-way and audited.
- A provider or actor can be replaced without changing workflow or database contracts.
- Availability and terms risk remain external dependencies. Operators must pause discovery if an
  actor changes behavior or loses acceptable provenance.
- Approved candidates still require the existing CRM research, entity-resolution, contact,
  compliance, message-approval, and send gates before any outreach.
