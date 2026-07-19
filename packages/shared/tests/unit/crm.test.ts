import { describe, expect, it } from "vitest";

import {
  allowedTransitionsFrom,
  canTransitionLead,
  evidenceInputSchema,
  leadUpdateSchema,
  manualLeadIngestSchema,
  normalizePublicUrl
} from "../../src/index.js";

describe("CRM lifecycle", () => {
  it("permits only declared forward and recovery transitions", () => {
    expect(canTransitionLead("discovered", "entity_resolved")).toBe(true);
    expect(canTransitionLead("contacted", "responded")).toBe(true);
    expect(canTransitionLead("no_contact", "researched")).toBe(true);
    expect(canTransitionLead("discovered", "scheduled")).toBe(false);
    expect(canTransitionLead("suppressed", "scheduled")).toBe(false);
    expect(allowedTransitionsFrom("mateo_owned")).toEqual(["suppressed"]);
  });

  it("treats a repeated status as an idempotent transition", () => {
    expect(canTransitionLead("researched", "researched")).toBe(true);
  });
});

describe("manual URL normalization", () => {
  it("normalizes public brand URLs and canonical domains", () => {
    expect(normalizePublicUrl("HTTPS://WWW.ExampleFood.COM:443/launch#hero")).toEqual({
      url: "https://www.examplefood.com/launch",
      domain: "examplefood.com"
    });
  });

  it.each([
    "file:///etc/passwd",
    "http://localhost:3000",
    "http://127.0.0.1/admin",
    "https://brand.local",
    "https://user:password@examplefood.com",
    "https://single-label"
  ])("rejects non-public or credential-bearing URL %s", (input) => {
    expect(() => normalizePublicUrl(input)).toThrow();
  });
});

describe("CRM request contracts", () => {
  it("trims and coerces a manual ingest payload", () => {
    expect(
      manualLeadIngestSchema.parse({
        sourceUrl: " https://examplefood.com/launch ",
        brandName: " Example Food ",
        country: " Spain ",
        stage: "prelaunch",
        preliminaryScore: "82"
      })
    ).toMatchObject({
      sourceUrl: "https://examplefood.com/launch",
      brandName: "Example Food",
      country: "Spain",
      stage: "prelaunch",
      preliminaryScore: 82
    });
  });

  it("rejects invalid evidence confidence", () => {
    expect(() =>
      evidenceInputSchema.parse({
        factType: "launch",
        claim: "Launching soon",
        quoteOrSummary: "Public launch page",
        sourceUrl: "https://examplefood.com",
        confidence: 1.2
      })
    ).toThrow();
  });

  it("requires at least one lead update field", () => {
    expect(() => leadUpdateSchema.parse({ reason: "No mutation" })).toThrow();
  });
});
