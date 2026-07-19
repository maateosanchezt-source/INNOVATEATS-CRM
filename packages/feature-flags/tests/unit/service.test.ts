import { describe, expect, it } from "vitest";

import { SafetyControlService, type SafetyControlRepository } from "../../src/index.js";

describe("SafetyControlService", () => {
  it("uses safe defaults for missing flags", async () => {
    const repository: SafetyControlRepository = {
      listFeatureFlags: async () => [
        {
          key: "research_enabled",
          enabled: true
        }
      ],
      listActiveKillSwitches: async () => []
    };

    const snapshot = await new SafetyControlService(repository).snapshot();

    expect(snapshot.flags.research_enabled).toBe(true);
    expect(snapshot.flags.email_send_enabled).toBe(false);
    expect(snapshot.flags.global_dry_run).toBe(true);
  });

  it("detects an active global kill switch", async () => {
    const repository: SafetyControlRepository = {
      listFeatureFlags: async () => [],
      listActiveKillSwitches: async () => [
        {
          id: "kill-1",
          scope: { type: "global" },
          active: true,
          reason: "Incident"
        }
      ]
    };

    const snapshot = await new SafetyControlService(repository).snapshot();

    expect(snapshot.globalKillSwitchActive).toBe(true);
  });

  it("provides a fail-closed snapshot when storage is unavailable", () => {
    const snapshot = SafetyControlService.safestPossibleSnapshot();

    expect(snapshot.globalKillSwitchActive).toBe(true);
    expect(snapshot.flags.email_send_enabled).toBe(false);
  });
});
