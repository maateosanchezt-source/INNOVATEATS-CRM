import { describe, expect, it } from "vitest";

import { defaultFeatureFlags } from "@innovateats/shared";

import { evaluateResearchGate } from "../../lib/research-policy.js";

describe("research gate", () => {
  it("requires both environment and database feature gates", () => {
    const disabled = evaluateResearchGate(true, {
      flags: defaultFeatureFlags,
      activeKillSwitches: [],
      globalKillSwitchActive: false
    });
    const enabled = evaluateResearchGate(true, {
      flags: { ...defaultFeatureFlags, research_enabled: true },
      activeKillSwitches: [],
      globalKillSwitchActive: false
    });

    expect(disabled.allowed).toBe(false);
    expect(enabled.allowed).toBe(true);
  });

  it("lets global and secure-fetch kill switches override enabled flags", () => {
    const gate = evaluateResearchGate(
      true,
      {
        flags: { ...defaultFeatureFlags, research_enabled: true },
        activeKillSwitches: [
          {
            id: "source-stop",
            scope: { type: "source", id: "secure_fetch" },
            active: true,
            reason: "Incident"
          }
        ],
        globalKillSwitchActive: false
      },
      "secure_fetch"
    );

    expect(gate).toEqual({
      allowed: false,
      reason: "secure_fetch is halted by a source kill switch."
    });
  });

  it("scopes source kill switches without blocking deterministic research decisions", () => {
    const gate = evaluateResearchGate(true, {
      flags: { ...defaultFeatureFlags, research_enabled: true },
      activeKillSwitches: [
        {
          id: "source-stop",
          scope: { type: "source", id: "secure_fetch" },
          active: true,
          reason: "Incident"
        }
      ],
      globalKillSwitchActive: false
    });

    expect(gate.allowed).toBe(true);
  });
});
