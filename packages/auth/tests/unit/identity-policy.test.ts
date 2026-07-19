import { describe, expect, it } from "vitest";

import { assertInternalIdentity, UnauthorizedInternalIdentityError } from "../../src/index.js";

describe("internal identity policy", () => {
  const authorizedEmail = "maateosanchezt@gmail.com";

  it("allows the exact verified Mateo identity", () => {
    expect(
      assertInternalIdentity(
        {
          email: "MaateoSanchezT@gmail.com",
          emailVerified: true
        },
        authorizedEmail
      )
    ).toBe(authorizedEmail);
  });

  it("rejects an unverified identity", () => {
    expect(() =>
      assertInternalIdentity(
        {
          email: authorizedEmail,
          emailVerified: false
        },
        authorizedEmail
      )
    ).toThrow(UnauthorizedInternalIdentityError);
  });

  it("rejects every other verified email", () => {
    expect(() =>
      assertInternalIdentity(
        {
          email: "someone-else@gmail.com",
          emailVerified: true
        },
        authorizedEmail
      )
    ).toThrow(UnauthorizedInternalIdentityError);
  });
});
