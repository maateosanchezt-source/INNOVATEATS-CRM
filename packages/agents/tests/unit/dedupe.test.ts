import { describe, expect, it } from "vitest";

import { deduplicateCandidates } from "../../src/index.js";

const brands = [
  "Northstar Gummies",
  "Luma Chews",
  "Cultiva Bar",
  "Halo Bites",
  "Ritual Sachets",
  "Morrow Candy",
  "Kite Gels",
  "Pollen Brittle",
  "Noma Lozenges",
  "Tide Protein",
  "Sage Snacks",
  "Vela Sticks",
  "Orbit Treats",
  "Plume Mix",
  "Aster Puree",
  "Kindred Bars",
  "Juniper Chews"
] as const;

const uniqueCandidates = brands.map((brandName, index) => ({
  brandName,
  productOneLiner: `Synthetic product ${index}.`,
  country: "United States",
  regionCode: "US" as const,
  sourceUrls: [`https://brand-${index}.com/launch`],
  discoverySignal: "Synthetic launch signal.",
  stage: "prelaunch" as const,
  preliminaryScore: 75,
  reasonToResearch: "Milestone 2 acceptance fixture.",
  duplicateKeys: []
}));

describe("candidate dedupe", () => {
  it("ingests 20 fixtures and resolves three duplicates deterministically", () => {
    const candidates = [
      ...uniqueCandidates,
      {
        ...uniqueCandidates[0],
        brandName: "Northstar Gummies US",
        sourceUrls: ["https://www.brand-0.com/crowdfunding"]
      },
      {
        ...uniqueCandidates[1],
        sourceUrls: ["https://brand-1.com/about"]
      },
      {
        ...uniqueCandidates[2],
        brandName: "CULTIVA BAR",
        sourceUrls: ["https://cultiva-fixture.com/launch"]
      }
    ];

    const result = deduplicateCandidates(candidates);

    expect(candidates).toHaveLength(20);
    expect(result.unique).toHaveLength(17);
    expect(result.duplicates).toHaveLength(3);
    expect(result.duplicates.map((record) => record.confidence)).toEqual([1, 1, 0.9]);
  });

  it("does not merge unrelated brands merely because they share a discovery platform", () => {
    const candidates = [
      {
        ...uniqueCandidates[0],
        sourceUrls: ["https://www.kickstarter.com/projects/a/brand-a"]
      },
      {
        ...uniqueCandidates[1],
        sourceUrls: ["https://www.kickstarter.com/projects/b/brand-b"]
      }
    ];

    const result = deduplicateCandidates(candidates);

    expect(result.unique).toHaveLength(2);
    expect(result.duplicates).toHaveLength(0);
  });
});
