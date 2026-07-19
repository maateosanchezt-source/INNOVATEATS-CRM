import { describe, expect, it } from "vitest";

import {
  noResponseWaitMilliseconds,
  phaseZeroReadiness,
  touchSteps,
  waitMillisecondsUntil
} from "../../src/index.js";

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

describe("outreach workflow contracts", () => {
  it("keeps the approved three-touch sequence and seven-day nurture delay", () => {
    expect(touchSteps).toEqual([1, 2, 3]);
    expect(noResponseWaitMilliseconds).toBe(7 * 24 * 60 * 60 * 1_000);
  });

  it("never returns a negative durable wait", () => {
    expect(
      waitMillisecondsUntil("2026-07-20T10:00:00.000Z", Date.parse("2026-07-20T09:00:00Z"))
    ).toBe(60 * 60 * 1_000);
    expect(
      waitMillisecondsUntil("2026-07-20T08:00:00.000Z", Date.parse("2026-07-20T09:00:00Z"))
    ).toBe(0);
  });
});
