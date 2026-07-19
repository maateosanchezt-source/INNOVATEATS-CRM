# ADR 0001: TypeScript monorepo and runtime boundaries

- Status: accepted for Phase 0
- Date: 2026-07-19

## Decision

Use Node.js 22, pnpm workspaces, Turborepo, TypeScript strict mode, Next.js App Router for the internal control plane, and a separate always-on worker process.

Business rules live in packages rather than framework routes. The web and worker applications are replaceable delivery mechanisms.

## Rationale

- One language and contract system across UI, API, workflows, and agents.
- Workspace protocol prevents accidental registry resolution of internal packages.
- Separate worker lifecycle protects durable processing from web deploys.
- Next.js 16 uses the supported App Router and Node proxy model.

## Consequences

- Cyclic workspace dependencies are prohibited.
- Every package owns its public API.
- Framework-specific types may not leak into domain packages.
