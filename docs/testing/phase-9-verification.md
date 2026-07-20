# Phase 9 verification

Phase 9 adds:

- fail-closed dry-run deployment preflight;
- placeholder and insecure-infrastructure rejection;
- one shared Temporal TLS/API-key connection contract for web and worker;
- non-root web and worker production images with healthchecks;
- an idempotent database bootstrap runtime;
- hardened provider-neutral Compose orchestration;
- CI builds for both final OCI image targets.

Local gate:

```text
pnpm check
pnpm db:migrate:check
pnpm deploy:preflight -- --env-file=deploy/runtime.env --mode=dry_run
```

The checked-in example intentionally fails preflight until real infrastructure, authentication and
secret-manager values replace every placeholder.
