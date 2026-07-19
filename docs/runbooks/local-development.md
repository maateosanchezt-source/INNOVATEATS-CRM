# Local development

1. Copy `.env.example` to `.env`.
2. Generate a strong `BETTER_AUTH_SECRET`.
3. Configure Google OAuth only when testing authentication.
4. Start infrastructure with Docker Compose.
5. Run migrations and seed.
6. Start web and worker with `pnpm dev`.

Google redirect URI:

`http://localhost:3000/api/auth/callback/google`

Never reuse local database passwords, auth secrets, OAuth clients, buckets, or sender accounts in staging or production.
