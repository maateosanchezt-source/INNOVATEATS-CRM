import { describe, expect, it } from "vitest";

import { isAuthorizedEmail, normalizeEmail } from "../../src/index.js";

describe("single-user identity policy", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeEmail("  MaateoSanchezT@GMAIL.COM ")).toBe("maateosanchezt@gmail.com");
  });

  it("only accepts the exact configured identity", () => {
    expect(isAuthorizedEmail("maateosanchezt@gmail.com", "maateosanchezt@gmail.com")).toBe(true);
    expect(isAuthorizedEmail("attacker+maateosanchezt@gmail.com", "maateosanchezt@gmail.com")).toBe(
      false
    );
  });
});
