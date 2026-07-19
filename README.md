# InnovatEats Outreach OS

Internal, single-tenant operating system for evidence-based CPG research, compliant outreach, and high-quality sales handoff.

## Phase 0 status

Foundations establish:

- a strict TypeScript monorepo;
- a Next.js internal control plane;
- a durable Temporal worker boundary;
- PostgreSQL schema and repeatable migrations;
- Google OAuth restricted to `maateosanchezt@gmail.com`;
- safe-by-default feature flags and kill switches;
- append-only audit logging;
- a global dry-run contract;
- an invariant that every outreach email contains `https://innovateats.com`.

No real email can be sent by Phase 0.

## Prerequisites

- Node.js 22.12 or later.
- pnpm 11.
- Docker with Compose for the complete local stack.

## Bootstrap

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d postgres temporal temporal-ui object-storage mailpit
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open:

- Web control plane: <http://localhost:3000>
- Worker health: <http://localhost:3001/health>
- Temporal UI: <http://localhost:8080>
- Mailpit: <http://localhost:8025>
- Object storage console: <http://localhost:9001>

## Safety defaults

The checked-in example configuration disables research, enrichment, generation, outbound email, autonomous email, inbound processing, and social queues. `GLOBAL_DRY_RUN` defaults to `true`.

The application refuses production startup when:

- the authorized user is not explicitly configured;
- the auth secret is missing or weak;
- dry-run is disabled while email sending remains unapproved;
- the required InnovatEats website is changed.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:migrate:check
```

Docker smoke verification is documented in `docs/testing/phase-0-verification.md`.
