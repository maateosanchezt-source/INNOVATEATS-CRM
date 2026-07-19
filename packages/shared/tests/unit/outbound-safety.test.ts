import { describe, expect, it } from "vitest";

import {
  containsRequiredInnovatEatsWebsite,
  defaultFeatureFlags,
  evaluateOutboundSafety
} from "../../src/index.js";

const safeMessage = "Mateo Sánchez\nInnovatEats — https://innovateats.com";

describe("outbound safety", () => {
  it("recognizes only the required InnovatEats web address", () => {
    expect(containsRequiredInnovatEatsWebsite(safeMessage)).toBe(true);
    expect(containsRequiredInnovatEatsWebsite("Read https://innovateats.com/about.")).toBe(true);
    expect(containsRequiredInnovatEatsWebsite("Visit innovateats.com")).toBe(false);
    expect(containsRequiredInnovatEatsWebsite("http://innovateats.com")).toBe(false);
    expect(containsRequiredInnovatEatsWebsite("https://notinnovateats.com")).toBe(false);
    expect(containsRequiredInnovatEatsWebsite("https://innovateats.com.evil.example")).toBe(false);
    expect(containsRequiredInnovatEatsWebsite("https://innovateats.com@evil.example")).toBe(false);
    expect(containsRequiredInnovatEatsWebsite("https://innovateats.com:8443")).toBe(false);
  });

  it("fails closed under Phase 0 defaults", () => {
    const decision = evaluateOutboundSafety({
      flags: defaultFeatureFlags,
      killSwitchActive: false,
      recipientSuppressed: false,
      policyDecision: "approval_required",
      approvalStatus: "approved",
      idempotencyKey: "campaign:lead:1:email",
      messageBody: safeMessage,
      autonomous: false
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(
      expect.arrayContaining(["global_dry_run_active", "email_send_disabled"])
    );
  });

  it("blocks a missing website even when all other gates pass", () => {
    const decision = evaluateOutboundSafety({
      flags: {
        ...defaultFeatureFlags,
        global_dry_run: false,
        email_send_enabled: true
      },
      killSwitchActive: false,
      recipientSuppressed: false,
      policyDecision: "approval_required",
      approvalStatus: "approved",
      idempotencyKey: "campaign:lead:1:email",
      messageBody: "A message without the mandatory trust link.",
      autonomous: false
    });

    expect(decision).toEqual({
      allowed: false,
      reasons: ["required_website_missing"]
    });
  });

  it("blocks suppression and kill switches independently", () => {
    const decision = evaluateOutboundSafety({
      flags: {
        ...defaultFeatureFlags,
        global_dry_run: false,
        email_send_enabled: true
      },
      killSwitchActive: true,
      recipientSuppressed: true,
      policyDecision: "allow",
      approvalStatus: "not_required",
      idempotencyKey: "campaign:lead:1:email",
      messageBody: safeMessage,
      autonomous: false
    });

    expect(decision.reasons).toEqual(
      expect.arrayContaining(["kill_switch_active", "recipient_suppressed"])
    );
  });

  it("allows an approved message only when every gate passes", () => {
    const decision = evaluateOutboundSafety({
      flags: {
        ...defaultFeatureFlags,
        global_dry_run: false,
        email_send_enabled: true
      },
      killSwitchActive: false,
      recipientSuppressed: false,
      policyDecision: "approval_required",
      approvalStatus: "approved",
      idempotencyKey: "campaign:lead:1:email",
      messageBody: safeMessage,
      autonomous: false
    });

    expect(decision).toEqual({ allowed: true, reasons: [] });
  });
});
