# Kill-switch runbook

## Trigger conditions

- Unexpected external action.
- Duplicate execution.
- High bounce or complaint signal.
- Policy uncertainty.
- Hallucinated claim.
- Cost threshold.
- Provider compromise.

## Immediate response

1. Activate the global kill switch.
2. Confirm `EMAIL_SEND_ENABLED=false`.
3. Cancel or pause affected Temporal workflows.
4. Preserve audit and workflow history.
5. Identify affected campaigns, leads, contacts, and messages.
6. Suppress contacts that requested no further contact.
7. Record root cause and regression fixture.

## Release

Only the authorized administrator may release a kill switch. Releasing creates a new audit event; history is never deleted.
