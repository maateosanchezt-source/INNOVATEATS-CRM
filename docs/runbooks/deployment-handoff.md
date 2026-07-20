# Deployment handoff

## What is already packaged

- `web-runtime`: Next.js standalone server, non-root, database-aware health endpoint.
- `worker-runtime`: compiled Temporal worker, non-root, readiness health endpoint.
- `bootstrap`: the same worker image running checksummed migrations and idempotent foundation seed.
- `deploy/compose.production.yaml`: hardened provider-neutral orchestration.
- `deploy/runtime.env.example`: a fail-closed secret/configuration template.
- `pnpm deploy:preflight`: configuration validation that never prints secret values.

Docker is not installed on the current workstation. Container builds are therefore validated in
GitHub CI.

## Inputs Mateo must provide

### Required to open the deployed CRM in dry-run

1. Final HTTPS URL, preferably a private CRM subdomain.
2. TLS PostgreSQL connection string plus backup/restore ownership.
3. Temporal endpoint, namespace and API key with TLS.
4. Unique `BETTER_AUTH_SECRET` stored only in the host secret manager.
5. Google OAuth web client for the authorized identity `maateosanchezt@gmail.com`.
6. Container host or server capable of running the web and worker images.

Google authentication callback:

`https://<crm-host>/api/auth/callback/google`

### Required to enable AI workflows

- `OPENAI_API_KEY`.
- Explicit model IDs for research, strategy, copy, QA and classification.
- A reviewed daily token budget.

AI flags remain false until all task routes pass preflight.

### Required only for Gmail sandbox/production

- Gmail sender address.
- Gmail OAuth client ID and secret.
- Redirect URI `https://<crm-host>/api/gmail/oauth/callback`.
- Random 32-byte base64 `GMAIL_TOKEN_ENCRYPTION_KEY`.
- Real reviewed postal address before US commercial email.
- Explicit OAuth approval for `gmail.readonly` before inbound processing.

The first deployment does not need Gmail credentials because it remains in `dry_run`.

## Prepare configuration

```text
copy deploy\runtime.env.example deploy\runtime.env
pnpm deploy:preflight -- --env-file=deploy/runtime.env --mode=dry_run
```

Populate secrets in the platform secret manager in a real deployment; `deploy/runtime.env` is for
an operator-controlled Docker host and is ignored by Git.

The preflight may warn about missing telemetry in a private dry-run. It fails on any missing boot
dependency or unsafe operating flag.

## Start on an OCI/Docker host

```text
docker compose -f deploy/compose.production.yaml config
docker compose -f deploy/compose.production.yaml build
docker compose -f deploy/compose.production.yaml up -d
```

Verify:

- `GET https://<crm-host>/api/health` returns HTTP 200 and `dryRun: true`;
- the worker healthcheck is healthy inside the private container network;
- bootstrap exited zero;
- Google sign-in accepts Mateo and rejects every other identity;
- `/readiness` reports production locked.

Terminate HTTPS in a reviewed reverse proxy/load balancer and forward it to the loopback-bound web
port. Never expose PostgreSQL, Temporal, the worker health port or a Temporal UI publicly.

## Promotion order

1. Deployed dry-run.
2. Mateo-only Gmail sandbox after explicit approval.
3. Controlled 50-lead production pilot after every readiness gate.

Each promotion requires a separate configuration change and matching database flags. Never jump
directly from dry-run to production.
