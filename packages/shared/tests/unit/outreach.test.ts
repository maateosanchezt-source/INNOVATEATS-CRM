import { describe, expect, it } from "vitest";

import {
  isPreferredSendWindow,
  nextPreferredSendWindow,
  outboundIdempotencyKey,
  sequenceWorkflowId
} from "../../src/outreach.js";

describe("outreach scheduling", () => {
  it("moves a weekend to Tuesday morning in the recipient timezone", () => {
    const after = new Date("2026-07-18T12:00:00.000Z");
    const scheduled = nextPreferredSendWindow(after, "Europe/Madrid");

    expect(scheduled.toISOString()).toBe("2026-07-21T07:00:00.000Z");
    expect(isPreferredSendWindow(scheduled, "Europe/Madrid")).toBe(true);
  });

  it("handles the New York daylight-saving offset", () => {
    const after = new Date("2026-11-02T17:00:00.000Z");
    const scheduled = nextPreferredSendWindow(after, "America/New_York");

    expect(scheduled.toISOString()).toBe("2026-11-03T14:00:00.000Z");
  });

  it("builds stable workflow and outbound idempotency keys", () => {
    const sequenceId = "10000000-0000-4000-8000-000000000001";
    const campaignId = "20000000-0000-4000-8000-000000000001";
    const leadId = "30000000-0000-4000-8000-000000000001";

    expect(sequenceWorkflowId(sequenceId)).toBe(`outreach-sequence:${sequenceId}`);
    expect(outboundIdempotencyKey(campaignId, leadId, 2)).toBe(`${campaignId}:${leadId}:2:email`);
  });

  it("rejects an invalid timezone", () => {
    expect(() => nextPreferredSendWindow(new Date(), "Mars/Olympus")).toThrow(
      /Invalid IANA timezone/u
    );
  });
});
