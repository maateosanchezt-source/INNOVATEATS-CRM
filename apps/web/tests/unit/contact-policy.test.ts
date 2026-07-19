import { describe, expect, it } from "vitest";

import { defaultFeatureFlags } from "@innovateats/shared";

import { evaluateContactGate } from "../../lib/contact-policy.js";

describe("contact-enrichment gate", () => {
  it("requires environment and database gates", () => {
    const snapshot = {
      flags: defaultFeatureFlags,
      activeKillSwitches: [],
      globalKillSwitchActive: false
    };

    expect(evaluateContactGate(false, snapshot).allowed).toBe(false);
    expect(evaluateContactGate(true, snapshot).allowed).toBe(false);
    expect(
      evaluateContactGate(true, {
        ...snapshot,
        flags: { ...defaultFeatureFlags, contact_enrichment_enabled: true }
      }).allowed
    ).toBe(true);
  });

  it("honors scoped verifier and global kill switches", () => {
    const snapshot = {
      flags: { ...defaultFeatureFlags, contact_enrichment_enabled: true },
      activeKillSwitches: [
        {
          id: "verifier-stop",
          scope: { type: "source" as const, id: "email_verifier" },
          active: true,
          reason: "Incident"
        }
      ],
      globalKillSwitchActive: false
    };

    expect(evaluateContactGate(true, snapshot).allowed).toBe(true);
    expect(evaluateContactGate(true, snapshot, "email_verifier").allowed).toBe(false);
    expect(evaluateContactGate(true, { ...snapshot, globalKillSwitchActive: true }).allowed).toBe(
      false
    );
  });
});
