import { describe, expect, it } from "vitest";

import { decideEntityResolution } from "../../src/index.js";

describe("entity resolution gate", () => {
  it("allows a well-evidenced canonical entity at the confidence threshold", () => {
    const result = decideEntityResolution({
      canonicalOrganization: "Fixture Foods",
      aliases: ["Fixture"],
      canonicalDomain: "www.fixturefoods.com",
      founders: [],
      profiles: [],
      duplicateCandidates: [],
      confidence: 0.85,
      evidenceIds: ["evidence-1"]
    });

    expect(result.decision).toBe("resolved");
    expect(result.mergeAllowed).toBe(true);
    expect(result.proposal.canonicalDomain).toBe("fixturefoods.com");
  });

  it("routes uncertain matches to manual review", () => {
    const result = decideEntityResolution({
      canonicalOrganization: "Fixture Foods",
      aliases: [],
      canonicalDomain: "fixturefoods.com",
      founders: [],
      profiles: [],
      duplicateCandidates: ["Possible Fixture"],
      confidence: 0.84,
      evidenceIds: ["evidence-1"]
    });

    expect(result.decision).toBe("manual_review");
    expect(result.mergeAllowed).toBe(false);
  });
});
