# Local deployment

The local deployment runs the production web and worker images against private local PostgreSQL
and Temporal. It is reachable on the LAN while every external capability remains fail-closed.

## Prepare once

Detect the active private IPv4 address and pass it explicitly:

```text
pnpm local:prepare -- --host=192.168.x.x
```

The command creates ignored `deploy/local.env` with random database and authentication secrets. It
never prints their values and never overwrites an existing file.

Google OAuth is intentionally blank. To enable sign-in, add the Google web client ID and secret to
`deploy/local.env` and register both:

- JavaScript origin: `http://<private-ip>:3000`
- Redirect URI: `http://<private-ip>:3000/api/auth/callback/google`

Only `maateosanchezt@gmail.com` is accepted by the application.

## Validate and start

```text
pnpm local:config
pnpm local:build
pnpm local:up
pnpm local:status
```

Local endpoints:

- CRM: `http://<private-ip>:3000`
- Health: `http://<private-ip>:3000/api/health`
- Worker health: `http://127.0.0.1:3002/health`
- Temporal UI: `http://127.0.0.1:8233`

PostgreSQL, Temporal and worker health are bound to loopback. Only the CRM web port is exposed to
the LAN.

The worker image uses a glibc-based Node runtime because Temporal's native bridge targets GNU
Linux. Keep that compatibility when upgrading the base image.

## Safety acceptance

The first boot must report:

- `dryRun: true`;
- `emailSendEnabled: false`;
- `autonomousSendEnabled: false`;
- `gmailDeliveryMode: dry_run`;
- production readiness locked.

Stop containers without deleting persistent volumes:

```text
pnpm local:down
```
