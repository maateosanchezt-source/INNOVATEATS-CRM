import { describe, expect, it } from "vitest";

import { extractPublicContacts } from "../../src/index.js";

const context = {
  organizationDomain: "brand.com",
  sourceDocumentId: "10000000-0000-4000-8000-000000000001",
  evidenceId: "20000000-0000-4000-8000-000000000001",
  country: "Spain",
  snapshot: {
    requestedUrl: "https://brand.com/",
    finalUrl: "https://brand.com/contact",
    title: "Contact",
    extractedText: "For a business enquiry write to founder@brand.com",
    contentHash: "a".repeat(64),
    contentType: "text/html",
    fetchedAt: "2026-07-19T12:00:00.000Z",
    byteLength: 500,
    redirectCount: 0,
    resolvedAddresses: ["93.184.216.34"],
    robotsDecision: "allowed" as const,
    publicLinks: [
      { kind: "mailto" as const, href: "mailto:hello@brand.com", label: "Email" },
      {
        kind: "anchor" as const,
        href: "https://brand.com/contact",
        label: "Contact us"
      },
      {
        kind: "anchor" as const,
        href: "https://www.linkedin.com/in/founder",
        label: "Founder"
      }
    ]
  }
};

describe("public contact extraction", () => {
  it("extracts only direct public paths and keeps plain-text email under review", () => {
    const result = extractPublicContacts(context);

    expect(result.contacts.map((contact) => contact.channelType)).toEqual([
      "corporate_email",
      "contact_form",
      "linkedin",
      "named_business_email"
    ]);
    expect(result.contacts[0]).toMatchObject({
      value: "hello@brand.com",
      verificationStatus: "published_verified",
      confidence: 0.99
    });
    expect(result.contacts[3]).toMatchObject({
      value: "founder@brand.com",
      verificationStatus: "manual_review"
    });
  });

  it("does not fabricate a contact when none is present", () => {
    const result = extractPublicContacts({
      ...context,
      snapshot: {
        ...context.snapshot,
        extractedText: "A functional product launching soon.",
        publicLinks: []
      }
    });

    expect(result.contacts).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it("blocks cross-domain source association", () => {
    const result = extractPublicContacts({
      ...context,
      snapshot: {
        ...context.snapshot,
        finalUrl: "https://unrelated.com/contact"
      }
    });

    expect(result.contacts).toEqual([]);
    expect(result.warnings[0]).toMatch(/not the canonical organization domain/iu);
  });
});
