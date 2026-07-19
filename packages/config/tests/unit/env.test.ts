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
      gmailDeliveryMode: "dry_run",
      inboundProcessingEnabled: false,
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
        GMAIL_DELIVERY_MODE: "production",
        GMAIL_SENDER_EMAIL: "maateosanchezt@gmail.com",
        PRODUCTION_SEND_APPROVED: "false"
      })
    ).toThrow(/Real email requires PRODUCTION_SEND_APPROVED=true/);
  });

  it("requires a separate explicit approval for sandbox delivery to Mateo", () => {
    expect(() =>
      parseServerEnvironment({
        EMAIL_SEND_ENABLED: "true",
        GLOBAL_DRY_RUN: "false",
        GMAIL_DELIVERY_MODE: "sandbox"
      })
    ).toThrow(/GMAIL_SANDBOX_SEND_APPROVED=true/u);

    expect(() =>
      parseServerEnvironment({
        GMAIL_DELIVERY_MODE: "sandbox",
        GMAIL_SANDBOX_RECIPIENT: "someone@example.com"
      })
    ).toThrow(/authorized internal user/u);
  });

  it("requires complete Gmail OAuth encryption configuration", () => {
    expect(() =>
      parseServerEnvironment({
        GMAIL_OAUTH_CLIENT_ID: "gmail-client"
      })
    ).toThrow(/GMAIL_OAUTH_CLIENT_ID/u);

    expect(() =>
      parseServerEnvironment({
        GMAIL_OAUTH_CLIENT_ID: "gmail-client",
        GMAIL_OAUTH_CLIENT_SECRET: "gmail-secret",
        GMAIL_OAUTH_REDIRECT_URI: "http://localhost:3000/api/gmail/oauth/callback",
        GMAIL_TOKEN_ENCRYPTION_KEY: "not-a-32-byte-key"
      })
    ).toThrow(/base64-encoded 32-byte key/u);

    expect(
      parseServerEnvironment({
        GMAIL_OAUTH_CLIENT_ID: "gmail-client",
        GMAIL_OAUTH_CLIENT_SECRET: "gmail-secret",
        GMAIL_OAUTH_REDIRECT_URI: "http://localhost:3000/api/gmail/oauth/callback",
        GMAIL_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
      }).GMAIL_OAUTH_CLIENT_ID
    ).toBe("gmail-client");
  });

  it("requires a strong production auth secret", () => {
    expect(() =>
      parseServerEnvironment({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "too-short"
      })
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("requires explicit restricted-scope approval before inbound processing", () => {
    expect(() =>
      parseServerEnvironment({
        INBOUND_PROCESSING_ENABLED: "true"
      })
    ).toThrow(/restricted gmail\.readonly scope/u);
  });

  it("does not allow the mandatory website to drift", () => {
    expect(() =>
      parseServerEnvironment({
        REQUIRED_OUTREACH_WEBSITE: "https://example.com"
      })
    ).toThrow(/REQUIRED_OUTREACH_WEBSITE/);
  });
});
