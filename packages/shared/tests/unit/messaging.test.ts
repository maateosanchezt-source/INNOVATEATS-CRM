import { describe, expect, it } from "vitest";

import {
  countMessageWords,
  messageDraftContentSchema,
  messageEvidenceMapItemSchema
} from "../../src/index.js";

describe("message contracts", () => {
  it("counts whitespace-separated message words deterministically", () => {
    expect(countMessageWords("  one\n two   three ")).toBe(3);
  });

  it("requires factual spans to cite evidence", () => {
    expect(
      messageEvidenceMapItemSchema.safeParse({
        textSpan: "The brand is crowdfunding.",
        kind: "fact",
        evidenceIds: []
      }).success
    ).toBe(false);
  });

  it("rejects an email without the exact InnovatEats website", () => {
    const body = Array.from({ length: 95 }, (_, index) => `word${index}`).join(" ");
    expect(
      messageDraftContentSchema.safeParse({
        channel: "email",
        sequenceStep: 1,
        subject: "A thought on Brand",
        body,
        language: "en",
        personalizationTokens: ["Brand", "Product"],
        evidenceMap: [
          {
            textSpan: "word0",
            kind: "offer",
            evidenceIds: []
          }
        ],
        wordCount: 95
      }).success
    ).toBe(false);
  });
});
