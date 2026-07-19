# Controlled pilot readiness runbook

## Automated preparation

1. Open `/readiness` and run the deterministic suite.
2. Confirm the report covers 100 fixtures, six regions, and golden cases A-J.
3. Treat `automated passed` and `pilot ready` as different decisions.
4. Confirm all five model routes name an explicitly configured strong-baseline model.
5. Download the owner data export and verify it contains no credentials or environment secrets.

## External evidence that cannot be auto-approved

- SPF, DKIM and DMARC results for the actual sender/domain.
- Reviewed sender profile, valid postal address and privacy notice.
- Backup/restore evidence, monitoring, incident owner and kill-switch drill.
- Budget caps, regional legal review and a signed pilot result.
- Real human draft scores averaging at least 4/5.
- Reply cancellation strictly below 60 seconds.
- Bounce rate strictly below 3% and zero complaints.

Record evidence in the checklist. A checklist update never changes feature flags, sender state,
delivery mode or production authorization.

## Pilot envelope

- Exactly 50 leads.
- US and UK corporate contacts only.
- Every message has human approval.
- Maximum 10 emails in any rolling 24-hour window.
- Review at messages 20 and 40.
- Maximum duration of 14 days.

Stop immediately on a complaint, suppression violation, unsupported claim, duplicate, policy
failure or any kill switch. Do not enable autonomous sending after a successful pilot; that is a
separate reviewed change.

## Data requests

`GET /api/data-governance/export` downloads all CRM records owned by the authorized user. Active
PII erasure requires the exact confirmation `ERASE <lead UUID>` and is permitted only for a
rejected, never-scheduled lead. Contacted records require a reviewed retention decision.
