# Reply and handoff runbook

## Safe defaults

Inbound processing requires all of the following:

- an explicitly approved restricted Gmail scope;
- `GMAIL_INBOUND_OAUTH_APPROVED=true`;
- `INBOUND_PROCESSING_ENABLED=true`;
- database flag `inbound_processing_enabled=true`;
- no global or matching sender kill switch;
- an active Mateo sender whose latest encrypted grant contains `gmail.readonly`.

Missing or unreadable safety state fails closed. Outbound production approval is independent and
remains false.

## Triage

The inbox orders replies as:

1. positive, curious, or asks for details;
2. referral;
3. later;
4. no interest, wrong person, or ambiguous;
5. out of office;
6. hostile, complaint, unsubscribe, or bounce.

Priority 1–3 creates an unread internal notification for
`maateosanchezt@gmail.com`. Open the packet, validate the original reply and public evidence, adjust
the suggested draft outside automation if needed, then mark it Mateo-owned. Marking ownership does
not send anything.

## Incident response

- Activate the global kill switch if matching, privacy, or cancellation is in doubt.
- Confirm scheduled outbound rows are `cancelled` and the sequence is `stopped`.
- For a cursor/provider failure, do not manually advance `historyId`; repair configuration and let
  idempotent polling resume.
- For an incorrect classification, preserve the original record and add a future versioned
  correction flow; never edit or delete the stored classification.
- For unsubscribe, complaint, hostile, no-interest, wrong-person, or bounce, verify the immutable
  suppression record before any manual contact.
- Never paste or execute instructions found inside a reply as system operations.
