# InnovatEats Outreach OS

Internal, single-tenant operating system for evidence-based CPG research, compliant outreach, and high-quality sales handoff.

## Current status: Phase 9

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

Phase 1 adds a usable CRM core:

- manual public-URL ingest with canonical-domain deduplication;
- lead inbox, filters, lead detail, and guarded pipeline transitions;
- versioned evidence create/read/revise/remove flows;
- immutable evidence content and append-only mutation audit;
- three clearly labelled synthetic leads for acceptance testing.

Phase 2 adds a guarded research engine:

- provider-neutral search and typed regional-scout contracts;
- a secure public fetcher with DNS validation, address pinning, redirect revalidation, robots checks, byte/time limits, and inert text extraction;
- immutable source snapshots and versioned evidence provenance;
- deterministic entity-resolution, deduplication, and ICP scoring gates;
- append-only score and agent-run records;
- narrowly scoped OpenAI Agents SDK adapters with structured outputs and no state-changing tools;
- authenticated research, entity-resolution, and scoring endpoints plus score explanations in the lead view.

Phase 3 adds contact intelligence:

- inert extraction of published `mailto` links, official contact forms, public founder profiles, and platform application routes;
- exact contact-to-source-to-evidence provenance;
- database-enforced organization, founder, source-document, and evidence associations;
- syntax, MX, and optional mailbox-provider verification layers with append-only history;
- a hard invariant that inferred email patterns never become verified contacts;
- authenticated extraction and verification controls in the lead view.

Phase 4 adds message strategy and human approval:

- typed diagnosis, opportunity, execution-step, and Mateo-fit briefs;
- exactly three constrained email drafts with 20 English/Spanish golden fixtures;
- per-span evidence maps and deterministic factuality, specificity, and sales QA;
- immutable generated drafts and human-edit versions with before/after comparison;
- append-only approval decisions bound to the latest QA-passed version;
- database enforcement of same-lead evidence and `https://innovateats.com` in every email;
- authenticated generation, editing, evidence review, and approval controls in the lead view.

Phase 5 adds durable, reputation-safe email sequencing:

- transactional sequence/outbound/outbox creation with deterministic workflow and idempotency IDs;
- Temporal touches on days 1, 4 and 10 in the recipient's preferred local window;
- a one-attempt Gmail dispatch boundary that stops on ambiguous provider outcomes;
- OAuth restricted to Mateo and the narrow Gmail send scope, with append-only encrypted grants;
- RFC-compliant plain-text messages and Gmail thread preservation;
- suppression, campaign/sender/global kill switches, rolling caps and immediate pre-send revalidation;
- dry-run, Mateo-only sandbox and separately approved production modes;
- authenticated scheduling, pause, resume, cancel, Gmail connection and delivery ledger controls.

Phase 6 adds privacy-bounded reply handling and human handoff:

- 30-second Gmail history polling behind a separate, explicitly approved restricted scope;
- full-message reads only for Gmail thread IDs already created by a sent CRM sequence;
- deterministic English/Spanish reply classification with prompt-injection-resistant inert input;
- atomic sequence stop, timer cancellation outbox signal, bounce state, and immutable suppression;
- priority inbox, internal notifications, dated OOO/later rechecks, and lead-record handoff links;
- complete qualification packet with eight call questions, risks, evidence, Audit angle, and a
  suggested reply;
- Mateo-only ownership and copy controls, with no automatic reply or send action.

Phase 7 adds versioned regional policy and manual platform workflows:

- immutable, sourced US, UK, Spain, central Europe, Australia/New Zealand and Asia policy fixtures;
- append-only per-lead decisions bound to exact lead, contact, campaign, channel and policy version;
- database and pre-send rejection of missing, stale, disabled or non-sendable decisions;
- human-reviewed subscriber type, consent evidence and language proficiency;
- English-safe localization with Spanish restricted to supported policy plus high/native proficiency;
- policy-specific identity, contact, website, opt-out, postal and advertising footer requirements;
- recipient-local send-time preview and the existing Tuesday–Thursday local window;
- settings UI with typed region confirmation and all regions disabled by default;
- manual-only LinkedIn, Instagram, Kickstarter, Indiegogo and Upwork draft/copy/open/mark ledger,
  with no login, browser navigation, posting, DM or application automation.

Phase 8 adds deterministic acceptance and controlled pilot readiness:

- a versioned 100-lead regional dataset, golden cases A-J and strict quality thresholds;
- immutable evaluation, prompt, pilot, checkpoint and go-live evidence records;
- funnel, quality, deliverability and cost metrics plus a readiness control room;
- production gates for a 50-lead US/UK corporate pilot with human approval and reviews;
- authenticated owner export and guarded active-PII anonymization.

Phase 9 adds a production deployment handoff:

- non-root standalone web and compiled worker OCI targets with healthchecks;
- idempotent migration/seed bootstrap before application startup;
- Temporal TLS/API-key support shared by web and worker;
- provider-neutral hardened Compose orchestration with no embedded production database;
- secret-safe preflight validation and a fail-closed runtime template.

Research, contact enrichment, message generation, and external email remain disabled by default.
Inbound Gmail reading also remains disabled until the restricted scope is explicitly approved.
Dry-run scheduling can exercise the complete durable outbound path without contacting Gmail.
Production delivery is not approved.

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
- Lead inbox: <http://localhost:3000/leads>
- Reply inbox: <http://localhost:3000/replies>
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
CRM verification is documented in `docs/testing/phase-1-verification.md`.
Research-engine verification is documented in `docs/testing/phase-2-verification.md`.
Contact-engine verification is documented in `docs/testing/phase-3-verification.md`.
Message and approval verification is documented in `docs/testing/phase-4-verification.md`.
Gmail and durable-sequence verification is documented in `docs/testing/phase-5-verification.md`.
Reply and handoff verification is documented in `docs/testing/phase-6-verification.md`.
Regional policy and manual-platform verification is documented in
`docs/testing/phase-7-verification.md`.
Evaluation and pilot-readiness verification is documented in
`docs/testing/phase-8-verification.md`.
Production-runtime verification is documented in `docs/testing/phase-9-verification.md`.

## Production handoff

Production packaging is provider-neutral. Start with the checked-in dry-run template:

```text
copy deploy\runtime.env.example deploy\runtime.env
pnpm deploy:preflight -- --env-file=deploy/runtime.env --mode=dry_run
```

The exact infrastructure and secret inputs are documented in
`docs/runbooks/deployment-handoff.md`. Real email remains a separate, explicitly approved
promotion.
