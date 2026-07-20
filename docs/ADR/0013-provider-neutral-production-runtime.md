# ADR 0013: Provider-neutral production runtime

## Status

Accepted for Phase 9. External actions remain disabled.

## Decision

- Package the web control plane as a Next.js standalone, non-root OCI image.
- Package the Temporal worker and database bootstrap as a separate non-root OCI image.
- Apply migrations and the idempotent foundation seed in a one-shot bootstrap service before web
  or worker starts.
- Require external PostgreSQL with transport encryption and external Temporal with TLS/API-key
  authentication. Do not embed development database credentials in the production topology.
- Keep the first deployed runtime in global dry-run with email, autonomous sending and production
  approval disabled.
- Validate deployment configuration without printing secret values. Placeholders, insecure
  infrastructure, a mismatched mode or an unauthorized identity fail the preflight.
- Bind the web port to loopback by default for termination behind a reviewed HTTPS reverse proxy.
  Do not publish the worker health port.

## Consequences

The same source can run on any host that accepts OCI images and private environment variables.
Provider selection does not change the application contract. A successful deployment preflight
proves configuration shape and safe posture; it does not certify DNS, legal review, sender
reputation, backups or pilot results.
