import { describe, expect, it } from "vitest";

import { phaseZeroReadiness } from "../../src/index.js";

describe("Phase 0 readiness workflow contract", () => {
  it("can never report email sending as enabled", () => {
    expect(phaseZeroReadiness("2026-07-19T00:00:00.000Z")).toEqual({
      ready: true,
      dryRun: true,
      emailSendEnabled: false,
      checkedAt: "2026-07-19T00:00:00.000Z"
    });
  });
});
