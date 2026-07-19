# Phase 0 verification

## Required automated checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:migrate:check
```

## Docker smoke test

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl --fail http://localhost:3000/api/health
curl --fail http://localhost:3001/health
docker compose down
```

Expected:

- PostgreSQL and Temporal report healthy.
- Web reports `dryRun: true` and outbound disabled.
- Worker is connected to Temporal.
- No email leaves Mailpit.

Docker verification must be run in CI or on a workstation with Docker when the local host does not provide Docker.
