import { describe, expect, it } from "vitest";

import {
  parseServerEnvironment,
  preflightDeployment,
  temporalConnectionConfiguration
} from "../../src/index.js";

function productionDryRun(overrides: Record<string, string> = {}) {
  return parseServerEnvironment({
    NODE_ENV: "production",
    APP_URL: "https://crm.innovateats.com",
    DATABASE_URL: "postgresql://crm:secret@database.internal:5432/innovateats?sslmode=require",
    TEMPORAL_ADDRESS: "namespace.tmprl.cloud:7233",
    TEMPORAL_NAMESPACE: "innovateats.namespace",
    TEMPORAL_TLS_ENABLED: "true",
    TEMPORAL_API_KEY: "temporal-secret",
    BETTER_AUTH_SECRET: "a-unique-auth-secret-with-at-least-thirty-two-characters",
    AUTHORIZED_EMAIL: "maateosanchezt@gmail.com",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GLOBAL_DRY_RUN: "true",
    GMAIL_DELIVERY_MODE: "dry_run",
    EMAIL_SEND_ENABLED: "false",
    AUTONOMOUS_SEND_ENABLED: "false",
    PRODUCTION_SEND_APPROVED: "false",
    ...overrides
  });
}

describe("deployment preflight", () => {
  it("accepts a production-hosted fail-closed dry-run without external send credentials", () => {
    const report = preflightDeployment(productionDryRun(), "dry_run");

    expect(report.ready).toBe(true);
    expect(report.checks.filter((item) => item.status === "fail")).toEqual([]);
    expect(report.checks.find((item) => item.key === "observability")?.status).toBe("warn");
  });

  it("rejects placeholders, insecure infrastructure, and a mismatched operating mode", () => {
    const environment = productionDryRun({
      APP_URL: "https://crm.example.invalid",
      DATABASE_URL: "postgresql://crm:secret@database.internal:5432/innovateats",
      TEMPORAL_API_KEY: "CHANGE_ME",
      GLOBAL_DRY_RUN: "false",
      EMAIL_SEND_ENABLED: "true",
      GMAIL_DELIVERY_MODE: "sandbox",
      GMAIL_SANDBOX_SEND_APPROVED: "true",
      GMAIL_OAUTH_CLIENT_ID: "gmail-client",
      GMAIL_OAUTH_CLIENT_SECRET: "gmail-secret",
      GMAIL_OAUTH_REDIRECT_URI: "https://crm.example.invalid/api/gmail/oauth/callback",
      GMAIL_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    });
    const report = preflightDeployment(environment, "dry_run");

    expect(report.ready).toBe(false);
    expect(report.checks.filter((item) => item.status === "fail").map((item) => item.key)).toEqual(
      expect.arrayContaining([
        "app_url",
        "database_tls",
        "temporal_authentication",
        "dry_run_posture"
      ])
    );
  });

  it("builds one TLS/API-key connection contract for web and worker", () => {
    expect(temporalConnectionConfiguration(productionDryRun())).toEqual({
      address: "namespace.tmprl.cloud:7233",
      tls: true,
      apiKey: "temporal-secret"
    });
  });

  it("refuses a Temporal API key over plaintext transport", () => {
    expect(() =>
      parseServerEnvironment({
        TEMPORAL_API_KEY: "secret",
        TEMPORAL_TLS_ENABLED: "false"
      })
    ).toThrow(/requires TLS/u);
  });
});
