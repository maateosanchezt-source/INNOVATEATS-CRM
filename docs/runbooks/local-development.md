# Local development

1. Copy `.env.example` to `.env`.
2. Generate a strong `BETTER_AUTH_SECRET`.
3. Configure Google OAuth only when testing authentication.
4. Start infrastructure with Docker Compose.
5. Run migrations and seed.
6. Start web and worker with `pnpm dev`.

The seed is idempotent and creates three synthetic sample leads. They are labelled as samples and must never be represented as real companies or evidence.

Google redirect URI:

`http://localhost:3000/api/auth/callback/google`

Never reuse local database passwords, auth secrets, OAuth clients, buckets, or sender accounts in staging or production.

## Research mode

Research is disabled by default. To exercise it in a controlled environment:

1. Set `RESEARCH_ENABLED=true`.
2. Enable the `research_enabled` database feature flag.
3. Confirm neither the global nor `secure_fetch` kill switch is active.
4. Configure `OPENAI_API_KEY` and `OPENAI_RESEARCH_MODEL` only when testing a live model-backed adapter.
5. Start with a domain you control and verify the stored URL, retrieval time, content hash, source snapshot, and evidence record.

The deterministic tests do not require network access or an OpenAI key. Never put an API key in a fixture, log, database snapshot, or committed environment file.
