import { describe, expect, it } from "vitest";

import { parseServerEnvironment, type ServerEnvironment } from "@innovateats/config";
import { SafetyControlService } from "@innovateats/feature-flags";

import { evaluateSequenceSchedulingGate } from "../../lib/send-policy.js";

describe("sequence scheduling gate", () => {
  it("allows the default dry run without enabling an external action", () => {
    const environment = parseServerEnvironment({ NODE_ENV: "test" });
    const safety = SafetyControlService.safestPossibleSnapshot();
    const withoutFailClosedSwitch = {
      ...safety,
      activeKillSwitches: [],
      globalKillSwitchActive: false
    };
    expect(evaluateSequenceSchedulingGate(environment, withoutFailClosedSwitch)).toEqual({
      allowed: true,
      reason: "Dry run is safe: no external action will occur."
    });
  });

  it("blocks production without explicit go-live approval", () => {
    const baseline = parseServerEnvironment({
      NODE_ENV: "test",
      GMAIL_DELIVERY_MODE: "production",
      GMAIL_SENDER_EMAIL: "maateosanchezt@gmail.com"
    });
    const environment: ServerEnvironment = {
      ...baseline,
      GLOBAL_DRY_RUN: false,
      EMAIL_SEND_ENABLED: true,
      PRODUCTION_SEND_APPROVED: false
    };
    const safety = {
      flags: {
        global_dry_run: false,
        research_enabled: false,
        contact_enrichment_enabled: false,
        message_generation_enabled: false,
        email_send_enabled: true,
        autonomous_send_enabled: false,
        inbound_processing_enabled: false,
        social_manual_queue_enabled: false
      },
      activeKillSwitches: [],
      globalKillSwitchActive: false
    } as const;
    expect(evaluateSequenceSchedulingGate(environment, safety).allowed).toBe(false);
  });

  it("blocks any active global kill switch", () => {
    const environment = parseServerEnvironment({ NODE_ENV: "test" });
    expect(
      evaluateSequenceSchedulingGate(environment, SafetyControlService.safestPossibleSnapshot())
        .allowed
    ).toBe(false);
  });
});
