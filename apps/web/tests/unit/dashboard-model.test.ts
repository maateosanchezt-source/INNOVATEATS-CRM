import { describe, expect, it } from "vitest";

import { defaultFeatureFlags } from "@innovateats/shared";

import { buildDashboardModel } from "../../lib/dashboard-model.js";

describe("dashboard model", () => {
  it("shows the dry-run banner under foundation defaults", () => {
    const model = buildDashboardModel({
      flags: defaultFeatureFlags,
      activeKillSwitches: [],
      globalKillSwitchActive: false
    });

    expect(model.status).toBe("safe");
    expect(model.banner).toContain("DRY RUN");
    expect(model.cards).toContainEqual({
      label: "Email sending",
      value: "DISABLED",
      tone: "safe"
    });
  });

  it("elevates a global kill switch above other status", () => {
    const model = buildDashboardModel({
      flags: defaultFeatureFlags,
      activeKillSwitches: [
        {
          id: "global",
          scope: { type: "global" },
          active: true,
          reason: "Incident"
        }
      ],
      globalKillSwitchActive: true
    });

    expect(model.status).toBe("halted");
    expect(model.banner).toContain("halted");
  });
});
