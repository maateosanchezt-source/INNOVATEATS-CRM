# Security policy

This application processes business contact data and controls external communication. Treat vulnerabilities affecting authentication, authorization, suppression, policy enforcement, idempotency, audit integrity, secret handling, SSRF, or prompt injection as high priority.

## Reporting

Do not put secrets or personal contact data in an issue. Report privately to Mateo Sánchez.

## Baseline controls

- Google OAuth is restricted to one exact verified email.
- Production has no development authentication bypass.
- OAuth tokens and secrets are never logged.
- Audit rows are protected from update and deletion at the database layer.
- Global and scoped kill switches fail closed.
- Outbound email is disabled by default.
- All public web content is untrusted.
- Provider integrations must use least-privilege scopes.

See `docs/security/threat-model.md`.
