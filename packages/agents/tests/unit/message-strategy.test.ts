import { describe, expect, it } from "vitest";

import {
  buildMessageSequence,
  remapHumanEditEvidence,
  reviewMessageDraft
} from "../../src/message-strategy.js";

const evidenceId = "10000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000001";

const goldenCases = Array.from({ length: 20 }, (_, index) => {
  const language = index % 2 === 0 ? ("en" as const) : ("es" as const);
  return {
    contactId,
    language,
    contactFirstName: index % 3 === 0 ? null : `Founder${index}`,
    brandName: `Golden Brand ${index + 1}`,
    productDescription:
      language === "en"
        ? `a shelf-stable vegetable snack range ${index + 1}`
        : `una gama de snacks vegetales estables ${index + 1}`,
    discoveryFact:
      language === "en"
        ? "The official product page presents three retail formats."
        : "La pagina oficial presenta tres formatos para retail.",
    specificOpportunity:
      language === "en"
        ? "clarifying the hero format before retailer outreach"
        : "aclarar el formato principal antes de contactar a retail",
    nextExecutionStep:
      language === "en"
        ? "the first retailer conversations"
        : "las primeras conversaciones con retail",
    opportunityType: "integrated" as const,
    selectedCredentials: ["integrated_operator"] as const,
    evidenceIds: [evidenceId]
  };
});

function firstGoldenCase() {
  const [first] = goldenCases;
  if (first === undefined) {
    throw new Error("Golden message fixtures must not be empty.");
  }
  return first;
}

describe("message strategy", () => {
  it.each(goldenCases)("builds golden evidence-backed sequence %#", (brief) => {
    const sequence = buildMessageSequence(brief);

    expect(sequence.drafts).toHaveLength(3);
    for (const draft of sequence.drafts) {
      expect(draft.body).toContain("https://innovateats.com");
      expect(draft.evidenceMap.length).toBeGreaterThan(0);
      expect(reviewMessageDraft(draft, brief.evidenceIds).passed).toBe(true);
    }
  });

  it("blocks factual evidence belonging to another lead", () => {
    const sequence = buildMessageSequence(firstGoldenCase());
    const review = reviewMessageDraft(sequence.drafts[0], ["30000000-0000-4000-8000-000000000001"]);

    expect(review.passed).toBe(false);
    expect(review.unsupportedClaims).not.toHaveLength(0);
  });

  it("rejects credentials that do not support the opportunity", () => {
    expect(() =>
      buildMessageSequence({
        ...firstGoldenCase(),
        opportunityType: "cultural",
        selectedCredentials: ["paid_media_200k"]
      })
    ).toThrow(/do not support opportunity type/u);
  });

  it("remaps human inference edits while freezing factual paragraphs", () => {
    const draft = buildMessageSequence(firstGoldenCase()).drafts[0];
    const paragraphs = draft.body.split(/\n{2,}/u);
    const inference = draft.evidenceMap.find((item) => item.kind === "inference");
    if (inference === undefined) {
      throw new Error("Golden draft requires an inference.");
    }
    const inferenceIndex = paragraphs.indexOf(inference.textSpan);
    paragraphs[inferenceIndex] = `${inference.textSpan} This remains a qualified possibility.`;
    const editedBody = paragraphs.join("\n\n");
    const evidenceMap = remapHumanEditEvidence(draft, editedBody);

    expect(evidenceMap.some((item) => item.textSpan.includes("qualified possibility"))).toBe(true);

    const fact = draft.evidenceMap.find((item) => item.kind === "fact");
    if (fact === undefined) {
      throw new Error("Golden draft requires a factual span.");
    }
    const factIndex = draft.body.split(/\n{2,}/u).indexOf(fact.textSpan);
    const factEdit = draft.body.split(/\n{2,}/u);
    factEdit[factIndex] = "A different unsupported fact.";
    expect(() => remapHumanEditEvidence(draft, factEdit.join("\n\n"))).toThrow(
      /factual paragraphs cannot be edited/u
    );
  });
});
