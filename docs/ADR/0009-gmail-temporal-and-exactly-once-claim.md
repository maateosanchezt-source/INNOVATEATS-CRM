# ADR 0009: Gmail, Temporal, and an exactly-once claim boundary

## Status

Accepted for Phase 5.

## Context

The CRM must schedule a three-touch sequence, preserve conversation threading, stop safely, and
protect sender reputation. Gmail does not expose an application idempotency key for
`users.messages.send`, so a blind activity retry can duplicate a real email.

The selected Gmail scope is only
`https://www.googleapis.com/auth/gmail.send`. Google classifies it as sensitive and documents it as
the narrow scope for sending on a user's behalf:
[Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

Google's send contract requires an RFC 2822 MIME message encoded as base64url:
[Sending email](https://developers.google.com/workspace/gmail/api/guides/sending) and
[`users.messages.send`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send).
Threading requires the Gmail `threadId`, matching subject, and RFC 2822 `References` and
`In-Reply-To` headers:
[Gmail threads](https://developers.google.com/workspace/gmail/api/guides/threads).

Long delays and signals must survive process restarts. Temporal workflows and durable timers are the
chosen boundary:
[Temporal TypeScript SDK](https://docs.temporal.io/develop/typescript) and
[workflow timers/timeouts](https://docs.temporal.io/develop/typescript/workflows/timeouts).

## Decision

- Scheduling writes the sequence, three immutable outbound rows, and `sequence.start` outbox event
  in one PostgreSQL transaction.
- The outbox processor starts a deterministic Temporal workflow ID and safely treats an
  already-started workflow as success.
- Touches are scheduled for Tuesday through Thursday, 09:00–11:30 in the recipient IANA timezone,
  on days 1, 4, and 10.
- Preparation activities may retry. The Gmail dispatch activity has `maximumAttempts: 1`.
- The database locks a `scheduled` outbound row and atomically changes it to `sending`. A competing
  worker cannot claim it.
- Every claim rechecks environment gates, database feature flags, kill switches, campaign/sender
  state, sender credential, suppression, contact actionability, latest immutable approval, required
  website, and rolling caps.
- A provider or network result that cannot be proven is stored as `delivery_unknown`; the sequence
  stops and no automatic retry occurs.
- Gmail refresh tokens are encrypted using AES-256-GCM and stored in append-only credential
  versions. OAuth state is hashed, expires after ten minutes, is actor-bound, and is one-use.
- The RFC message is plain text first. Every approved body and final rendered message contains
  `https://innovateats.com` and an easy reply-based opt-out.
- `sandbox` rewrites the recipient to `maateosanchezt@gmail.com`. `dry_run` performs no external
  action. Neither mode advances the lead as contacted.
- `production` remains closed until explicit go-live approval and all environment/database gates
  are simultaneously enabled.

## Consequences

The system chooses possible manual reconciliation over a duplicate email when Gmail acceptance is
ambiguous. This is intentionally conservative for sender reputation. Recovery is automatic for
outbox/workflow startup and preparation work, but never for an uncertain external send.

OAuth uses Google's server-side offline-access flow so a worker can refresh access without a browser:
[OAuth 2.0 for web server applications](https://developers.google.com/workspace/gmail/api/auth/web-server).
