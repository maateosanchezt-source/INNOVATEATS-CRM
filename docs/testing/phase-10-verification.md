# Phase 10 verification

Required gates:

1. `pnpm check`
2. `pnpm db:migrate:check`
3. `pnpm local:prepare -- --host=<private-ip>`
4. `pnpm local:config`
5. `pnpm local:build`
6. `pnpm local:up`
7. Web and worker health endpoints return HTTP 200.
8. Web and worker both report dry-run with email disabled.
9. Bootstrap exits zero after applying checksummed migrations and foundations.
10. `quality` and `migrations` GitHub checks pass before merge.

The generated `deploy/local.env` must remain ignored and must not appear in Git status or any test
output.

## Local acceptance record

Verified on 2026-07-20 with Docker Desktop:

- production web and worker images built successfully;
- PostgreSQL and Temporal reported healthy;
- bootstrap exited zero after confirming all 9 migrations;
- web health returned HTTP 200 through loopback and the active private IPv4 address;
- worker health returned HTTP 200 with Temporal connected;
- Temporal UI returned HTTP 200 through loopback;
- web reported `dryRun: true`, `emailSendEnabled: false`, and
  `autonomousSendEnabled: false`;
- worker reported `dryRun: true` and `emailSendEnabled: false`;
- browser smoke testing found the required `innovateats.com` link, the authorized Mateo identity,
  disabled Google sign-in while OAuth credentials are absent, and no console errors.
