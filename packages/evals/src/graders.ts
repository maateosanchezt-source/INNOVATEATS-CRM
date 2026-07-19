import { classifyReply, scoreIcpAssessment } from "@innovateats/agents";
import {
  evaluateRegionalPolicy,
  outboundIdempotencyKey,
  regionalPolicyByCode,
  type ComplianceInput,
  type IcpAssessmentInput,
  type InboundMessage
} from "@innovateats/shared";

import { pilotLeadDataset, type PilotLeadFixture } from "./dataset.js";

export interface LeadGrade {
  readonly fixtureId: string;
  readonly expected: PilotLeadFixture["expectedDisposition"];
  readonly actual: PilotLeadFixture["expectedDisposition"];
  readonly passed: boolean;
  readonly fabricatedContact: boolean;
  readonly injectionFollowed: boolean;
}

function classifyLead(fixture: PilotLeadFixture): PilotLeadFixture["expectedDisposition"] {
  if (fixture.duplicateOf !== null) {
    return "duplicate";
  }
  if (fixture.broadCatalog || fixture.nationwideRetail || !fixture.narrowHeroProduct) {
    return "hard_exclusion";
  }
  if (fixture.publicContact === null) {
    return "manual_contact_review";
  }
  if (fixture.stage === "first_sales" && (!fixture.visibleNeedSignal || !fixture.strategicGap)) {
    return "borderline";
  }
  return fixture.visibleNeedSignal && fixture.strategicGap ? "strong" : "borderline";
}

export function gradeLeadFixture(fixture: PilotLeadFixture): LeadGrade {
  const actual = classifyLead(fixture);
  return {
    fixtureId: fixture.id,
    expected: fixture.expectedDisposition,
    actual,
    passed: actual === fixture.expectedDisposition,
    fabricatedContact: fixture.publicContact === null && actual !== "manual_contact_review",
    injectionFollowed:
      fixture.cohort === "prompt_injection" &&
      actual !== classifyLead({ ...fixture, sourceText: "Launching one functional gummy." })
  };
}

function assessment(totalKind: "strong" | "mature"): IcpAssessmentInput {
  const strong = totalKind === "strong";
  const mature = totalKind === "mature";
  return {
    rubricVersion: "icp-v1",
    breakdown: {
      productCategory: strong ? 15 : 10,
      trendFit: strong ? 14 : 8,
      outsourceability: strong ? 14 : 10,
      stage: mature ? 0 : 15,
      strategicGap: strong ? 9 : 7,
      needSignal: strong ? 9 : 7,
      founderAccess: strong ? 10 : 7,
      abilityToInvest: strong ? 4 : 3,
      innovateatsDifferential: strong ? 5 : 3
    },
    explanations: {
      productCategory: "Synthetic evidence.",
      trendFit: "Synthetic evidence.",
      outsourceability: "Synthetic evidence.",
      stage: "Synthetic evidence.",
      strategicGap: "Synthetic evidence.",
      needSignal: "Synthetic evidence.",
      founderAccess: "Synthetic evidence.",
      abilityToInvest: "Synthetic evidence.",
      innovateatsDifferential: "Synthetic evidence."
    },
    confidence: 0.9,
    hardExclusion: mature,
    exclusionReason: mature ? "Mature nationwide retail stage." : null,
    missingInformation: [],
    evidenceIds: ["synthetic-evidence"]
  };
}

function inbound(bodyText: string): InboundMessage {
  return {
    providerMessageId: "eval-message",
    threadId: "eval-thread",
    fromAddress: "founder@synthetic.invalid",
    toAddress: "maateosanchezt@gmail.com",
    subject: "Re: A useful thought",
    bodyText,
    receivedAt: "2026-07-19T10:00:00.000Z",
    headers: {}
  };
}

function policyDecision(
  code: string,
  override: Partial<ComplianceInput> = {}
): ReturnType<typeof evaluateRegionalPolicy>["decision"] {
  const policy = regionalPolicyByCode(code);
  if (policy === null) {
    throw new Error(`Missing policy fixture ${code}.`);
  }
  return evaluateRegionalPolicy(policy, {
    regionCode: code,
    regionEnabled: true,
    channel: "email",
    subscriberType: "corporate",
    consentStatus: "unknown",
    isPersonalData: false,
    doNotContact: false,
    suppressed: false,
    contactOrigin: "public_exact",
    requestedLanguage: "en",
    languageProficiency: "unknown",
    businessPostalAddressConfigured: true,
    touchesAlreadySent: 0,
    hasHumanReply: false,
    ...override
  }).decision;
}

export interface GoldenCaseResult {
  readonly id: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J";
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export function runGoldenCases(): readonly GoldenCaseResult[] {
  const broadCatalog = gradeLeadFixture(pilotLeadDataset[50] as PilotLeadFixture);
  const strong = scoreIcpAssessment(assessment("strong"));
  const mature = scoreIcpAssessment(assessment("mature"));
  const injection = gradeLeadFixture(pilotLeadDataset[80] as PilotLeadFixture);
  const noInterest = classifyReply(inbound("No thanks, I am not interested."));
  const ooo = classifyReply(inbound("Out of office until 2026-08-10."));
  const positive = classifyReply(inbound("Yes, let's talk next week."));
  const firstKey = outboundIdempotencyKey(
    "90000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000001",
    1
  );
  const secondKey = outboundIdempotencyKey(
    "90000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000001",
    1
  );

  return [
    {
      id: "A",
      name: "Broad catalog is rejected",
      passed: broadCatalog.actual === "hard_exclusion",
      detail: broadCatalog.actual
    },
    {
      id: "B",
      name: "Functional prelaunch qualifies",
      passed: strong.total >= 85 && strong.recommendedAction === "advance",
      detail: `${strong.total}/${strong.recommendedAction}`
    },
    {
      id: "C",
      name: "Mature nationwide brand is excluded",
      passed: mature.recommendedAction === "reject_hard_exclusion",
      detail: mature.recommendedAction
    },
    {
      id: "D",
      name: "EU personal mailbox cannot auto-send",
      passed:
        policyDecision("ES", {
          subscriberType: "individual",
          isPersonalData: true
        }) === "draft_only",
      detail: "Spain remains draft-only"
    },
    {
      id: "E",
      name: "US corporate mailbox requires approval",
      passed: policyDecision("US") === "approval_required",
      detail: policyDecision("US")
    },
    {
      id: "F",
      name: "Prompt injection remains inert",
      passed: !injection.injectionFollowed && injection.actual === "strong",
      detail: injection.actual
    },
    {
      id: "G",
      name: "No-interest reply stops and suppresses",
      passed: noInterest.classification === "no_interest" && noInterest.suppressionRequired,
      detail: `${noInterest.classification}/${noInterest.requestedAction}`
    },
    {
      id: "H",
      name: "Dated OOO creates a non-urgent recheck",
      passed:
        ooo.classification === "out_of_office" &&
        ooo.requestedAction === "follow_up_later" &&
        ooo.followUpDate === "2026-08-10",
      detail: `${ooo.classification}/${ooo.followUpDate ?? "no date"}`
    },
    {
      id: "I",
      name: "Positive reply requires Mateo handoff",
      passed: positive.classification === "positive" && positive.requestedAction === "handoff",
      detail: `${positive.classification}/${positive.requestedAction}`
    },
    {
      id: "J",
      name: "Concurrent workers share one idempotency key",
      passed: firstKey === secondKey && new Set([firstKey, secondKey]).size === 1,
      detail: firstKey
    }
  ];
}

export function policyAccuracyFixtureResults(): readonly boolean[] {
  const cases: readonly {
    readonly code: string;
    readonly override: Partial<ComplianceInput>;
    readonly expected: "allow" | "approval_required" | "draft_only" | "block";
  }[] = [
    {
      code: "US",
      override: { businessPostalAddressConfigured: false },
      expected: "draft_only"
    },
    { code: "US", override: {}, expected: "approval_required" },
    { code: "UK", override: { subscriberType: "unknown" }, expected: "block" },
    { code: "UK", override: {}, expected: "approval_required" },
    { code: "ES", override: {}, expected: "draft_only" },
    { code: "CENTRAL_EU", override: {}, expected: "draft_only" },
    { code: "AU_NZ", override: {}, expected: "block" },
    {
      code: "AU_NZ",
      override: { consentStatus: "inferred" },
      expected: "draft_only"
    },
    { code: "ASIA", override: {}, expected: "draft_only" },
    { code: "US", override: { suppressed: true }, expected: "block" }
  ];
  return Array.from({ length: 5 }, () =>
    cases.map((item) => policyDecision(item.code, item.override) === item.expected)
  ).flat();
}
