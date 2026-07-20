import { describe, expect, it } from "vitest";

import {
  createDiscoveryCampaignSchema,
  discoveryWorkflowId,
  normalizeInstagramHandle
} from "../../src/index.js";

describe("Instagram discovery contracts", () => {
  it("normalizes profile seed URLs without accepting arbitrary paths", () => {
    expect(normalizeInstagramHandle("https://www.instagram.com/My.Brand/")).toBe("my.brand");
    expect(normalizeInstagramHandle("@founder_store")).toBe("founder_store");
    expect(() => normalizeInstagramHandle("not valid!")).toThrow(/valid public Instagram/u);
  });

  it("accepts a bounded Spain campaign and rejects inverted follower limits", () => {
    const campaign = createDiscoveryCampaignSchema.parse({
      name: "Spain first 500",
      regionCode: "ES",
      targetCandidates: 500,
      minFollowers: 50,
      maxFollowers: 50_000,
      seeds: [
        {
          kind: "keyword",
          value: "snack saludable España",
          track: "food_brand"
        },
        {
          kind: "profile_followers",
          value: "@ecommerce_seed",
          track: "dropshipping_founder"
        }
      ]
    });

    expect(campaign.targetCandidates).toBe(500);
    expect(campaign.seeds[1]?.value).toBe("ecommerce_seed");
    expect(() =>
      createDiscoveryCampaignSchema.parse({
        ...campaign,
        minFollowers: 1_000,
        maxFollowers: 100
      })
    ).toThrow(/Maximum followers/u);
  });

  it("creates deterministic Temporal workflow identifiers", () => {
    const runId = "10000000-0000-4000-8000-000000000011";
    expect(discoveryWorkflowId(runId)).toBe(`instagram-discovery:${runId}`);
  });
});
