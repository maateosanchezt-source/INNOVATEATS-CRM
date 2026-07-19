import { describe, expect, it } from "vitest";

import { SafetyControlService } from "@innovateats/feature-flags";

import { evaluateSocialManualGate } from "../../lib/social-policy.js";

describe("social manual queue gate", () => {
  it("fails closed unless environment and database gates are both open", () => {
    expect(
      evaluateSocialManualGate(false, SafetyControlService.safestPossibleSnapshot()).allowed
    ).toBe(false);
    expect(
      evaluateSocialManualGate(true, SafetyControlService.safestPossibleSnapshot()).allowed
    ).toBe(false);
  });

  it("allows draft creation without authorizing a platform action", () => {
    expect(
      evaluateSocialManualGate(true, {
        flags: {
          global_dry_run: true,
          research_enabled: false,
          contact_enrichment_enabled: false,
          message_generation_enabled: false,
          email_send_enabled: false,
          autonomous_send_enabled: false,
          inbound_processing_enabled: false,
          social_manual_queue_enabled: true
        },
        activeKillSwitches: [],
        globalKillSwitchActive: false
      })
    ).toEqual({
      allowed: true,
      reason: "Manual draft creation is enabled; no platform action is automated."
    });
  });
});
