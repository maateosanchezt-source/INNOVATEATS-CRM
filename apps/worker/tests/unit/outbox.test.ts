import { describe, expect, it, vi } from "vitest";

import type { Client } from "@temporalio/client";

import { dispatchSequenceOutboxEvent } from "../../src/outbox.js";

describe("sequence stop outbox", () => {
  it("signals the durable workflow immediately for a human reply", async () => {
    const signal = vi.fn().mockResolvedValue(undefined);
    const getHandle = vi.fn().mockReturnValue({ signal });
    const temporal = {
      workflow: { getHandle }
    } as unknown as Client;

    await dispatchSequenceOutboxEvent(temporal, "innovateats-main", {
      id: "event-1",
      eventType: "sequence.stop",
      sequenceId: "sequence-1",
      workflowId: "outreach-sequence:sequence-1",
      reason: "human_reply"
    });

    expect(getHandle).toHaveBeenCalledWith("outreach-sequence:sequence-1");
    expect(signal).toHaveBeenCalledOnce();
    expect(signal.mock.calls[0]?.[1]).toBe("human_reply");
  });
});
