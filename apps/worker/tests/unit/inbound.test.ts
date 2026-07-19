import { describe, expect, it } from "vitest";

import { referencesForKnownThreads } from "../../src/inbound.js";

describe("inbound Gmail privacy boundary", () => {
  it("keeps only message references from CRM-owned threads before a full fetch", () => {
    const selected = referencesForKnownThreads(
      [
        { providerMessageId: "known-reply", threadId: "known-thread" },
        { providerMessageId: "private-mail", threadId: "unrelated-thread" },
        { providerMessageId: "known-reply", threadId: "known-thread" }
      ],
      [{ threadId: "known-thread", sequenceId: "sequence-1" }]
    );

    expect(selected).toEqual([{ providerMessageId: "known-reply", threadId: "known-thread" }]);
  });
});
