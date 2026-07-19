# Email delivery runbook

## Safe operating modes

`dry_run` is the checked-in mode. It executes the complete schedule, workflow, approval and
pre-send decision path, then records `dry_run` without contacting Gmail.

`sandbox` is an external action. It requires:

- `GLOBAL_DRY_RUN=false`;
- `EMAIL_SEND_ENABLED=true`;
- the matching database flags;
- `GMAIL_DELIVERY_MODE=sandbox`;
- `GMAIL_SANDBOX_SEND_APPROVED=true`;
- `GMAIL_SANDBOX_RECIPIENT=maateosanchezt@gmail.com`;
- an active, OAuth-connected Mateo sender;
- no applicable kill switch.

The original lead address is retained for decision trace and cap checks but the actual Gmail
recipient is rewritten to Mateo.

`production` additionally requires `PRODUCTION_SEND_APPROVED=true`. Do not set it until the Phase 8
pilot and explicit human go-live decision. A configuration change alone is insufficient: database
flags, campaign, sender, approval, contact, suppression, caps and kill switches are rechecked inside
the claim transaction.

## Connect Gmail

1. Configure a Google OAuth web client whose callback exactly matches
   `GMAIL_OAUTH_REDIRECT_URI`.
2. Generate a 32-byte random key and store its base64 representation in
   `GMAIL_TOKEN_ENCRYPTION_KEY`.
3. Sign in to the CRM as `maateosanchezt@gmail.com`.
4. On a lead page, select **Connect Gmail as Mateo**.
5. Confirm the sender ledger shows `connected`.

Only `openid`, `email`, and `https://www.googleapis.com/auth/gmail.send` are requested. The callback
rejects any verified identity other than the configured Mateo sender.

## Incident response

- Activate the global kill switch first. The next claim fails closed.
- Pause or cancel affected sequences in the lead ledger.
- Never change `delivery_unknown` back to `scheduled`. Inspect Gmail manually using the deterministic
  `Message-ID`, then record the reconciliation in a future dedicated flow.
- Add bounces, unsubscribes and explicit objections to the suppression list; suppression rows cannot
  be updated or deleted.
- Rotate the Gmail OAuth grant by reconnecting. Each grant creates a new encrypted version.
- Rotate `GMAIL_TOKEN_ENCRYPTION_KEY` only with a planned credential re-encryption procedure; old
  grants cannot be decrypted with a new key.
