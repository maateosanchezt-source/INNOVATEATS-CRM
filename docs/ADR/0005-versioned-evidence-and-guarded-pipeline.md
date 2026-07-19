# ADR 0005: Versioned evidence and guarded pipeline

## Status

Accepted.

## Context

CRM users need to correct research while preserving provenance. Lead states also control later agent, compliance, and sending workflows, so arbitrary status changes would bypass safety invariants.

## Decision

- Evidence content is immutable after insertion.
- A revision inserts a new version, links it through `supersedes_id`, and marks the old version superseded in the same transaction.
- Delete is a soft tombstone; PostgreSQL rejects physical deletion and in-place content edits.
- Only the active evidence version appears in the default lead view.
- Pipeline transitions use an explicit state graph shared by UI, API, and repository.
- Every transition and evidence mutation writes to the append-only audit log.
- Manual URL ingest deduplicates on canonical domain and never starts an agent or network fetch.

## Consequences

Research history consumes more rows but remains reconstructable. Recovery paths must be explicit. Later agents can propose evidence and status changes, but the repository remains the enforcement boundary.
