import { describe, expect, it } from "vitest";

import { defaultFeatureFlags } from "@innovateats/shared";

import { evaluateMessageGenerationGate } from "../../lib/message-policy.js";

describe("message-generation gate", () => {
  const snapshot = {
    flags: defaultFeatureFlags,
    activeKillSwitches: [],
    globalKillSwitchActive: false
  };

  it("requires both environment and database gates", () => {
    expect(evaluateMessageGenerationGate(false, snapshot).allowed).toBe(false);
    expect(evaluateMessageGenerationGate(true, snapshot).allowed).toBe(false);
    expect(
      evaluateMessageGenerationGate(true, {
        ...snapshot,
        flags: { ...defaultFeatureFlags, message_generation_enabled: true }
      }).allowed
    ).toBe(true);
  });

  it("fails closed on global and scoped kill switches", () => {
    const enabled = {
      ...snapshot,
      flags: { ...defaultFeatureFlags, message_generation_enabled: true }
    };
    expect(
      evaluateMessageGenerationGate(true, { ...enabled, globalKillSwitchActive: true }).allowed
    ).toBe(false);
    expect(
      evaluateMessageGenerationGate(
        true,
        {
          ...enabled,
          activeKillSwitches: [
            {
              id: "message-stop",
              scope: { type: "source" as const, id: "message_strategy" },
              active: true,
              reason: "QA incident"
            }
          ]
        },
        "message_strategy"
      ).allowed
    ).toBe(false);
  });
});
