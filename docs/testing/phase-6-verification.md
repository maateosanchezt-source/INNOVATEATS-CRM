# Phase 6 verification

## Automated acceptance

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm db:migrate:check
```

The suite verifies:

- positive, details, referral, no-interest, unsubscribe, complaint, bounce, OOO, Spanish date, and
  prompt-injection fixtures;
- plain-text MIME preference and rejection of outgoing/non-inbound Gmail messages;
- filtering to CRM-owned thread references before full-message reads;
- durable `sequence.stop` signaling for a human reply;
- all seven migrations on a new database;
- exact sent-thread/contact/sender association for inbound storage;
- immutable inbound bodies and classification, one-way handoff ownership, notification read state,
  and monotonic Gmail history cursors;
- mandatory suppression for unsubscribe, complaint, and bounce classifications;
- authenticated reply APIs, inbox, handoff detail, lead link, copy-only draft, and Mateo ownership
  build successfully.

## Simulated acceptance

Keep Gmail inbound disabled. Use deterministic fixtures or a local database transaction to simulate:

1. a positive reply: sequence stops, future touches cancel, priority 1 notification and handoff are
   created;
2. a no-interest reply: sequence stops and the contact enters immutable suppression;
3. a dated OOO: sequence stops, no urgent notification is created, and a recheck task uses the
   parsed date;
4. a bounce: sequence stops, the sent outbound gets `bounce_type=unknown`, and suppression is
   created;
5. a Temporal stop event: the active timer receives `stopOutreach` and cannot dispatch a later
   touch.

Confirm every suggested reply contains `https://innovateats.com` and no fixture causes an external
send.
