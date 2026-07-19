# ADR 0003: Single-user Google authentication

- Status: accepted for Phase 0
- Date: 2026-07-19

## Decision

Use Better Auth with Google OAuth and PostgreSQL sessions. Only the normalized, verified email `maateosanchezt@gmail.com` may create or use an account.

Authentication and Gmail authorization are configured as separate least-privilege grants even when they belong to the same human identity.

## Security properties

- Exact allowlist matching, not domain substring matching.
- No production authentication bypass.
- Account linking disabled.
- Session validation occurs server-side on every protected route.
- Provider tokens are treated as secrets and never logged.

## Future

RBAC can be added without changing the external identity provider. A future user must be explicitly invited.
