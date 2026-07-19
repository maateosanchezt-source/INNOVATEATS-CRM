import { describe, expect, it } from "vitest";

import {
  EnvironmentValidationError,
  parseServerEnvironment,
  publicSafetyConfiguration
} from "../../src/index.js";

describe("server environment", () => {
  it("defaults to a fully disabled outbound posture", () => {
    const environment = parseServerEnvironment({});

    expect(publicSafetyConfiguration(environment)).toEqual({
      authorizedEmail: "maateosanchezt@gmail.com",
      autonomousSendEnabled: false,
      dryRun: true,
      emailSendEnabled: false,
      requiredWebsite: "https://innovateats.com"
    });
    expect(environment.EMAIL_VERIFIER_PROVIDER).toBe("disabled");
  });

  it("parses the string false as false", () => {
    const environment = parseServerEnvironment({
      GLOBAL_DRY_RUN: "false",
      EMAIL_SEND_ENABLED: "false"
    });

    expect(environment.GLOBAL_DRY_RUN).toBe(false);
    expect(environment.EMAIL_SEND_ENABLED).toBe(false);
  });

  it("requires both Google OAuth credentials", () => {
    expect(() =>
      parseServerEnvironment({
        GOOGLE_CLIENT_ID: "client-id"
      })
    ).toThrow(EnvironmentValidationError);
  });

  it("blocks unapproved real email", () => {
    expect(() =>
      parseServerEnvironment({
        EMAIL_SEND_ENABLED: "true",
        GLOBAL_DRY_RUN: "false",
        PRODUCTION_SEND_APPROVED: "false"
      })
    ).toThrow(/Real email requires PRODUCTION_SEND_APPROVED=true/);
  });

  it("requires a strong production auth secret", () => {
    expect(() =>
      parseServerEnvironment({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "too-short"
      })
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("does not allow the mandatory website to drift", () => {
    expect(() =>
      parseServerEnvironment({
        REQUIRED_OUTREACH_WEBSITE: "https://example.com"
      })
    ).toThrow(/REQUIRED_OUTREACH_WEBSITE/);
  });
});
