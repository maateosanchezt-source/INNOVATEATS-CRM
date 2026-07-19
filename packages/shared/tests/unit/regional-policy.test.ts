import { describe, expect, it } from "vitest";

import {
  evaluateRegionalPolicy,
  regionalPolicyByCode,
  regionalPolicyFixtures,
  regionPolicySchema,
  resolveRegionalLanguage,
  type ComplianceInput,
  type RegionPolicy
} from "../../src/index.js";

const baseline: ComplianceInput = {
  regionCode: "US",
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
  hasHumanReply: false
};

function policy(code: string): RegionPolicy {
  const match = regionalPolicyByCode(code);
  if (match === null) {
    throw new Error(`Missing fixture ${code}.`);
  }
  return match;
}

describe("regional policy fixtures", () => {
  it("validates every versioned fixture and preserves the universal website rule", () => {
    expect(regionalPolicyFixtures).toHaveLength(6);
    for (const fixture of regionalPolicyFixtures) {
      expect(regionPolicySchema.parse(fixture)).toEqual(fixture);
      expect(fixture.rules.some((rule) => rule.includes("https://innovateats.com"))).toBe(true);
      expect(fixture.maximumTouches).toBe(3);
    }
  });

  it("keeps US email behind postal-address and human-approval gates", () => {
    expect(
      evaluateRegionalPolicy(policy("US"), {
        ...baseline,
        businessPostalAddressConfigured: false
      }).decision
    ).toBe("draft_only");
    expect(evaluateRegionalPolicy(policy("US"), baseline).decision).toBe("approval_required");
  });

  it("distinguishes UK corporate subscribers from individuals and unknowns", () => {
    const uk = { ...baseline, regionCode: "UK" } as const;
    expect(evaluateRegionalPolicy(policy("UK"), uk).decision).toBe("approval_required");
    expect(
      evaluateRegionalPolicy(policy("UK"), {
        ...uk,
        subscriberType: "unknown"
      }).decision
    ).toBe("block");
    expect(
      evaluateRegionalPolicy(policy("UK"), {
        ...uk,
        subscriberType: "sole_trader",
        consentStatus: "express"
      }).decision
    ).toBe("approval_required");
  });

  it("keeps Spain, central Europe and Asia draft-only", () => {
    for (const code of ["ES", "CENTRAL_EU", "ASIA"]) {
      expect(
        evaluateRegionalPolicy(policy(code), {
          ...baseline,
          regionCode: code
        }).decision
      ).toBe("draft_only");
    }
  });

  it("requires AU/NZ consent evidence", () => {
    const input = { ...baseline, regionCode: "AU_NZ" } as const;
    expect(evaluateRegionalPolicy(policy("AU_NZ"), input).decision).toBe("block");
    expect(
      evaluateRegionalPolicy(policy("AU_NZ"), {
        ...input,
        consentStatus: "inferred"
      }).decision
    ).toBe("draft_only");
  });

  it("makes every platform channel manual and blocks suppression before region rules", () => {
    expect(
      evaluateRegionalPolicy(policy("US"), {
        ...baseline,
        channel: "linkedin"
      }).decision
    ).toBe("draft_only");
    expect(
      evaluateRegionalPolicy(policy("US"), {
        ...baseline,
        suppressed: true
      }).decision
    ).toBe("block");
  });

  it("fails closed for replies, exhausted touch caps and inferred addresses", () => {
    for (const override of [
      { hasHumanReply: true },
      { touchesAlreadySent: 3 },
      { contactOrigin: "inferred_pattern" as const }
    ]) {
      expect(
        evaluateRegionalPolicy(policy("US"), {
          ...baseline,
          ...override
        }).decision
      ).toBe("block");
    }
  });

  it("uses Spanish only with a supported policy and high proficiency", () => {
    expect(resolveRegionalLanguage(policy("ES"), "es", "high")).toBe("es");
    expect(resolveRegionalLanguage(policy("ES"), "es", "unknown")).toBe("en");
    expect(resolveRegionalLanguage(policy("US"), "es", "native")).toBe("en");
  });
});
