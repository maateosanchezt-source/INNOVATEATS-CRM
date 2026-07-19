# ADR 0011: Versioned regional policy and manual-only platforms

## Status

Accepted for Phase 7; legal review and external activation deferred.

## Context

Electronic-marketing rules differ by destination and recipient type. The policy engine must make a
repeatable operational decision without claiming that software replaces legal advice. Official
sources establish material distinctions:

- The US FTC states that CAN-SPAM applies to B2B email and requires accurate headers and subjects,
  advertising disclosure, a valid physical postal address, a clear opt-out, and timely honoring of
  opt-outs:
  [CAN-SPAM compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business).
- The UK ICO distinguishes corporate subscribers from individual subscribers, including sole
  traders and some partnerships, while identity, opt-out and UK GDPR duties still apply:
  [Business-to-business marketing](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/).
- Spain's LSSI articles 20–22 govern commercial communications, identification, prior authorization
  and simple opposition:
  [consolidated LSSI](https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758).
- The EDPB describes the three-part legitimate-interest assessment and the immediate effect of a
  direct-marketing objection:
  [legitimate-interest summary](https://www.edpb.europa.eu/system/files/2024-10/edpb_summary_202401_legitimateinterest_en.pdf)
  and [right to object](https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_ga).
- Australia requires consent, sender identification and a functional unsubscribe, and prohibits
  harvested lists:
  [ACMA spam guidance](https://www.acma.gov.au/avoid-sending-spam).
- New Zealand separately requires consent, accurate sender information and a functional
  unsubscribe:
  [DIA spam law](https://www.dia.govt.nz/Spam-NZ-Spam-Law).
- Singapore regulates bulk unsolicited commercial electronic messages:
  [PDPC spam guidance](https://www.pdpc.gov.sg/complaints-and-reviews/before-you-lodge-a-complaint-with-us-3/spam).

## Decision

- Store immutable policy snapshots by region and version, with source URLs, hash, lifecycle and
  human approval. Allow only `draft -> active -> retired`; never overwrite policy content.
- Store every compliance decision append-only with lead, contact, campaign, channel, input hash,
  exact policy version, reasons and legal-basis tag.
- Require an associated current decision for every external sequence in both PostgreSQL and the
  application. Recheck active policy, region enablement, decision class, suppression, reply state,
  contact actionability and all existing send gates inside the final claim transaction.
- Keep every region disabled by default. US and UK are human-approval modes. Spain, central Europe,
  Australia/New Zealand and Asia remain draft-only. Missing country adapters fail closed.
- Require a real configured `BUSINESS_POSTAL_ADDRESS` before US external email; never synthesize
  one. Use `maateosanchezt@gmail.com` as the business contact email until a complete verified domain
  mailbox is supplied.
- Include accurate Mateo / InnovatEats identity, `https://innovateats.com`, business contact and a
  simple opt-out in every email. Apply policy-specific postal, advertising and unsubscribe footer
  requirements.
- Use recipient-local Tuesday–Thursday 09:00–11:30 scheduling and no more than three touches. Stop
  after any reply, objection, suppression or do-not-contact signal.
- Use Spanish only when the active policy supports it and Mateo has recorded high or native
  proficiency. Otherwise require English.
- Generate LinkedIn, Instagram, Kickstarter, Indiegogo and Upwork text only into an internal manual
  ledger. The system may copy text and open a recorded direct public URL; it never logs in,
  navigates, posts, sends a DM, submits a proposal or circumvents platform workflows.
- Suggest retention of 90 days for rejected/uncontacted records, 730 days for contacted records,
  180 days for policy snapshots, and indefinite minimal suppression identifiers. Execution of
  deletion/anonymization is deferred to a dedicated reviewed retention job.

## Consequences

The policy result is conservative and operational, not legal advice. A region toggle alone cannot
enable production because environment flags, database flags, sender/campaign state, Gmail
configuration, human message approval and explicit production go-live remain separate gates.
Policy changes invalidate external use of older decisions automatically. Platform work requires
Mateo's visible manual action and remains auditable without credential or browser automation.
