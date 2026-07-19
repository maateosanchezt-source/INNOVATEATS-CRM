import { describe, expect, it } from "vitest";

import {
  DisabledEmailVerificationProvider,
  FixtureEmailVerificationProvider,
  verifyBusinessEmail,
  type MxResolver
} from "../../src/index.js";

class FixtureMxResolver implements MxResolver {
  public constructor(private readonly result: boolean | Error) {}

  public async hasMx(): Promise<boolean> {
    await Promise.resolve();
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

describe("email verification", () => {
  it("rejects invalid syntax and domains without MX", async () => {
    const provider = new DisabledEmailVerificationProvider();
    const invalidSyntax = await verifyBusinessEmail(
      "not-an-email",
      new FixtureMxResolver(true),
      provider,
      { origin: "published_public" }
    );
    const missingMx = await verifyBusinessEmail(
      "hello@brand.com",
      new FixtureMxResolver(false),
      provider,
      { origin: "published_public" }
    );

    expect(invalidSyntax.status).toBe("invalid");
    expect(missingMx.status).toBe("invalid");
  });

  it("distinguishes MX validity from mailbox verification", async () => {
    const result = await verifyBusinessEmail(
      "hello@brand.com",
      new FixtureMxResolver(true),
      new DisabledEmailVerificationProvider(),
      { origin: "published_public" }
    );

    expect(result).toMatchObject({
      status: "mx_valid",
      mxFound: true,
      provider: null,
      providerVerdict: "unknown"
    });
  });

  it("accepts a configured provider verdict for a published address", async () => {
    const result = await verifyBusinessEmail(
      "hello@brand.com",
      new FixtureMxResolver(true),
      new FixtureEmailVerificationProvider("fixture", {
        "hello@brand.com": { verdict: "verified", reason: "Fixture mailbox exists." }
      }),
      { origin: "published_public", now: () => new Date("2026-07-19T12:00:00.000Z") }
    );

    expect(result.status).toBe("provider_verified");
    expect(result.provider).toBe("fixture");
  });

  it("never promotes an inferred pattern to verified", async () => {
    const result = await verifyBusinessEmail(
      "guessed@brand.com",
      new FixtureMxResolver(true),
      new FixtureEmailVerificationProvider("fixture", {
        "guessed@brand.com": { verdict: "verified", reason: "Mailbox exists." }
      }),
      { origin: "inferred_pattern" }
    );

    expect(result.status).toBe("manual_review");
    expect(result.reason).toMatch(/never become verified/iu);
  });

  it("fails DNS uncertainty to manual review instead of claiming invalid", async () => {
    const result = await verifyBusinessEmail(
      "hello@brand.com",
      new FixtureMxResolver(new Error("DNS unavailable")),
      new DisabledEmailVerificationProvider(),
      { origin: "published_public" }
    );

    expect(result.status).toBe("manual_review");
  });
});
