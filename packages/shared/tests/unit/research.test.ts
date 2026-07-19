import { describe, expect, it } from "vitest";

import {
  icpAssessmentInputSchema,
  icpScoreResultSchema,
  publicSearchRequestSchema,
  regionalCandidateSchema
} from "../../src/index.js";

describe("research contracts", () => {
  it("defaults a bounded public search", () => {
    expect(
      publicSearchRequestSchema.parse({
        regionCode: "US",
        query: "functional gummies crowdfunding"
      })
    ).toEqual({
      regionCode: "US",
      query: "functional gummies crowdfunding",
      limit: 20
    });
  });

  it("rejects a hard exclusion without an explanation", () => {
    expect(() =>
      icpAssessmentInputSchema.parse({
        rubricVersion: "icp-v1",
        breakdown: {
          productCategory: 15,
          trendFit: 15,
          outsourceability: 10,
          stage: 15,
          strategicGap: 5,
          needSignal: 8,
          founderAccess: 7,
          abilityToInvest: 3,
          innovateatsDifferential: 5
        },
        explanations: {
          productCategory: "One hero format.",
          trendFit: "Clear functional trend.",
          outsourceability: "Known manufacturing route.",
          stage: "Prelaunch.",
          strategicGap: "Visible launch gap.",
          needSignal: "Crowdfunding.",
          founderAccess: "Public founder profile.",
          abilityToInvest: "Production signal.",
          innovateatsDifferential: "Product, brand and ecommerce fit."
        },
        confidence: 0.8,
        hardExclusion: true,
        exclusionReason: null,
        missingInformation: [],
        evidenceIds: ["evidence-1"]
      })
    ).toThrow(/exclusion reason/iu);
  });

  it("requires regional candidates to cite at least one source", () => {
    const candidate = {
      brandName: "Fixture Foods",
      productOneLiner: "A fixture gummy.",
      country: "United States",
      regionCode: "US",
      sourceUrls: [],
      discoverySignal: "Fixture launch.",
      stage: "prelaunch",
      preliminaryScore: 80,
      reasonToResearch: "Acceptance fixture.",
      duplicateKeys: []
    };

    expect(regionalCandidateSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects a forged ICP total or action", () => {
    const result = icpScoreResultSchema.safeParse({
      rubricVersion: "icp-v1",
      breakdown: {
        productCategory: 15,
        trendFit: 15,
        outsourceability: 10,
        stage: 15,
        strategicGap: 5,
        needSignal: 8,
        founderAccess: 7,
        abilityToInvest: 3,
        innovateatsDifferential: 5
      },
      explanations: {
        productCategory: "One hero format.",
        trendFit: "Clear functional trend.",
        outsourceability: "Known manufacturing route.",
        stage: "Prelaunch.",
        strategicGap: "Visible launch gap.",
        needSignal: "Crowdfunding.",
        founderAccess: "Public founder profile.",
        abilityToInvest: "Production signal.",
        innovateatsDifferential: "Product, brand and ecommerce fit."
      },
      confidence: 0.8,
      hardExclusion: false,
      exclusionReason: null,
      missingInformation: [],
      evidenceIds: ["evidence-1"],
      total: 100,
      recommendedAction: "advance"
    });

    expect(result.success).toBe(false);
  });
});
