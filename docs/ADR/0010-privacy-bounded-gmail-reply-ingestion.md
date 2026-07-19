# ADR 0010: Privacy-bounded Gmail reply ingestion

## Status

Accepted for Phase 6; external activation deferred.

## Context

Reply detection must stop an active sequence in under 60 seconds without reading or storing Mateo's
unrelated personal email. Google's `gmail.readonly` scope is restricted. Google states that apps
storing or transmitting restricted-scope data may need verification and a security assessment:
[Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) and
[Google API Services User Data Policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy).

Gmail's synchronization guide defines an initial/full synchronization followed by partial
`history.list` synchronization, requires storage of the latest `historyId`, and documents HTTP 404
for an expired cursor:
[Synchronize a Gmail client](https://developers.google.com/workspace/gmail/api/guides/sync).
Google recommends polling synchronization for user-owned device use cases, while push remains a
future option:
[Push notifications](https://developers.google.com/workspace/gmail/api/guides/push).

## Decision

- Keep `GMAIL_INBOUND_OAUTH_APPROVED=false` and `INBOUND_PROCESSING_ENABLED=false` by default.
- Request `gmail.readonly` only after the explicit approval flag is set; the existing send-only
  grant remains the default.
- Poll Gmail history every 30 seconds. Filter message references against thread IDs from sent CRM
  outbounds before calling `users.messages.get(format=full)`.
- On first use or an expired history cursor, perform a bounded resync of at most 500 known CRM
  threads. Capture the baseline history ID before scanning so concurrent new replies are processed
  by the next partial sync.
- Never fetch or persist unrelated mailbox bodies and never log reply bodies.
- Parse MIME as inert text, prefer `text/plain`, and treat external instructions as data.
- Match sender mailbox, CRM thread, and verified contact address both in application code and a
  PostgreSQL trigger.
- Ingest the reply, stop and cancel the sequence, classify, suppress/recheck, create the handoff,
  notify Mateo, and enqueue a durable stop signal in one transaction.
- Lock the sequence before both reply ingestion and outbound claim so reply/send races serialize.
- Never send or auto-reply from the inbound subsystem. Mateo gets a suggested draft containing
  `https://innovateats.com`, a copy action, and an explicit ownership action.

## Consequences

The privacy boundary is stronger than a general inbox sync, but bounded recovery can make more Gmail
API calls when the cursor expires. The 30-second interval satisfies the cancellation target under
normal provider and worker operation. Restricted-scope activation remains a separate go-live
decision with external verification/security-assessment risk; no production capability is opened by
this phase.
