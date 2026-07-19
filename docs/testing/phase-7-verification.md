# Phase 7 verification

## Automated acceptance

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm db:migrate:check
```

The suite verifies:

- all six regional policy fixtures parse and contain the mandatory InnovatEats website, local
  window, three-touch cap, retention metadata and official sources;
- US postal-address and approval gates;
- UK corporate versus individual-subscriber behavior;
- Spain, central Europe and Asia draft-only behavior;
- Australia/New Zealand consent evidence;
- universal suppression, reply, provenance and touch-cap blocks;
- safe English fallback and restricted Spanish localization;
- the social queue stays behind both feature gates;
- all eight migrations apply to a new database;
- external sequences without a matching compliance decision are rejected by PostgreSQL;
- policy snapshots and compliance decisions are append-only, social content is immutable, and
  manual queue states are one-way by database trigger.

## Manual acceptance

1. Seed locally and sign in only as `maateosanchezt@gmail.com`.
2. Open **Regions** and confirm every region starts disabled with an active version and official
   source links.
3. Type a region code to enable it. Confirm production remains closed.
4. On a lead, review subscriber type, consent evidence and language proficiency.
5. Schedule a dry run. Confirm the UI shows the policy result, effective language and recipient
   local time, and that Gmail is not called.
6. With no `BUSINESS_POSTAL_ADDRESS`, confirm US policy stays draft-only.
7. Enable both social-manual flags locally, create a public platform draft, copy it, open the direct
   URL and mark it sent manually. Confirm no browser navigation, login, post, DM or proposal
   submission occurs automatically.
8. Disable the region after scheduling and confirm any external pre-send claim fails closed.

Do not approve production or restricted Gmail inbound access during Phase 7.
