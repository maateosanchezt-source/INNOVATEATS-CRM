import { describe, expect, it } from "vitest";

import { scoreIcpAssessment } from "../../src/index.js";

const explanations = {
  productCategory: "One hero product.",
  trendFit: "Clear functional trend.",
  outsourceability: "Known co-manufacturing route.",
  stage: "Prelaunch.",
  strategicGap: "Visible launch gap.",
  needSignal: "Crowdfunding signal.",
  founderAccess: "Public founder profile.",
  abilityToInvest: "Production signal.",
  innovateatsDifferential: "Product, brand and ecommerce fit."
} as const;

describe("deterministic ICP scorer", () => {
  it("calculates the total and advances a confident A lead", () => {
    const result = scoreIcpAssessment({
      rubricVersion: "icp-v1",
      breakdown: {
        productCategory: 15,
        trendFit: 15,
        outsourceability: 15,
        stage: 15,
        strategicGap: 8,
        needSignal: 8,
        founderAccess: 7,
        abilityToInvest: 3,
        innovateatsDifferential: 5
      },
      explanations,
      confidence: 0.82,
      hardExclusion: false,
      exclusionReason: null,
      missingInformation: [],
      evidenceIds: ["evidence-1"]
    });

    expect(result.total).toBe(91);
    expect(result.recommendedAction).toBe("advance");
  });

  it("requires manual research when score confidence is below 0.7", () => {
    const result = scoreIcpAssessment({
      rubricVersion: "icp-v1",
      breakdown: {
        productCategory: 15,
        trendFit: 15,
        outsourceability: 15,
        stage: 15,
        strategicGap: 10,
        needSignal: 10,
        founderAccess: 10,
        abilityToInvest: 5,
        innovateatsDifferential: 5
      },
      explanations,
      confidence: 0.69,
      hardExclusion: false,
      exclusionReason: null,
      missingInformation: ["Manufacturing evidence"],
      evidenceIds: ["evidence-1"]
    });

    expect(result.total).toBe(100);
    expect(result.recommendedAction).toBe("manual_research");
  });

  it("lets hard exclusions override a high numeric score", () => {
    const result = scoreIcpAssessment({
      rubricVersion: "icp-v1",
      breakdown: {
        productCategory: 15,
        trendFit: 15,
        outsourceability: 15,
        stage: 15,
        strategicGap: 10,
        needSignal: 10,
        founderAccess: 10,
        abilityToInvest: 5,
        innovateatsDifferential: 5
      },
      explanations,
      confidence: 0.95,
      hardExclusion: true,
      exclusionReason: "Broad mature catalog.",
      missingInformation: [],
      evidenceIds: ["evidence-1"]
    });

    expect(result.recommendedAction).toBe("reject_hard_exclusion");
  });
});
