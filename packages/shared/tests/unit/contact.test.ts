import { describe, expect, it } from "vitest";

import {
  contactCandidateSchema,
  contactIsActionable,
  normalizeContactValue
} from "../../src/index.js";

const baseCandidate = {
  founderId: null,
  fullName: null,
  role: null,
  channelType: "corporate_email" as const,
  value: "hello@brand.com",
  directUrl: "mailto:hello@brand.com",
  sourceUrl: "https://brand.com/contact",
  sourceDocumentId: "10000000-0000-4000-8000-000000000001",
  evidenceId: "20000000-0000-4000-8000-000000000001",
  origin: "published_public" as const,
  provenance: "Official contact page mailto.",
  verificationStatus: "published_verified" as const,
  verificationProvider: null,
  isPersonalData: false,
  country: null,
  confidence: 0.98
};

describe("contact contracts", () => {
  it("normalizes email and public URL values", () => {
    expect(normalizeContactValue("corporate_email", " Hello@Brand.COM ")).toBe("hello@brand.com");
    expect(normalizeContactValue("contact_form", "https://www.brand.com/contact#form")).toBe(
      "https://www.brand.com/contact"
    );
  });

  it("accepts a published official contact", () => {
    expect(contactCandidateSchema.parse(baseCandidate)).toMatchObject(baseCandidate);
    expect(contactIsActionable("published_public", "published_verified")).toBe(true);
  });

  it("never accepts an inferred pattern as verified or actionable", () => {
    expect(
      contactCandidateSchema.safeParse({
        ...baseCandidate,
        origin: "inferred_pattern",
        verificationStatus: "provider_verified",
        verificationProvider: "fixture"
      }).success
    ).toBe(false);
    expect(contactIsActionable("inferred_pattern", "provider_verified")).toBe(false);
  });

  it("requires provider provenance before a broker result is actionable", () => {
    expect(contactIsActionable("data_broker", "unverified")).toBe(false);
    expect(
      contactCandidateSchema.safeParse({
        ...baseCandidate,
        origin: "data_broker",
        verificationStatus: "provider_verified",
        verificationProvider: null
      }).success
    ).toBe(false);
  });
});
