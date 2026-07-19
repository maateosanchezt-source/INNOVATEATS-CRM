import {
  handoffPacketSchema,
  INNOVATEATS_WEBSITE,
  type HandoffPacket,
  type ReplyClassification
} from "@innovateats/shared";

export interface HandoffContext {
  readonly brandName: string;
  readonly founderNames: readonly string[];
  readonly product: string | null;
  readonly stage: string;
  readonly discoverySignal: string | null;
  readonly opportunity: string | null;
  readonly messageHistory: readonly string[];
  readonly replyBody: string;
  readonly replyFrom: string;
  readonly evidence: readonly {
    readonly claim: string;
    readonly sourceUrl: string;
  }[];
}

function suggestedReply(context: HandoffContext, classification: ReplyClassification): string {
  const greeting = "Thanks for getting back to me.";
  if (classification.classification === "referral") {
    return `${greeting} I appreciate the direction. I will keep the context concise when I contact the right person.\n\nMateo\n${INNOVATEATS_WEBSITE}`;
  }
  if (
    classification.classification === "positive" ||
    classification.classification === "curious" ||
    classification.classification === "asks_for_details"
  ) {
    return `${greeting} I would be glad to compare notes. A focused 25-minute call should be enough to understand where ${context.brandName} is now and whether I can add useful perspective. What time works for you?\n\nMateo\n${INNOVATEATS_WEBSITE}`;
  }
  if (classification.classification === "later") {
    return `${greeting} Understood. I will leave it here and follow your timing. If useful when the moment is right, you can find the InnovatEats context at ${INNOVATEATS_WEBSITE}.\n\nMateo`;
  }
  return `${greeting} I have noted your message and will not send an automated follow-up.\n\nMateo\n${INNOVATEATS_WEBSITE}`;
}

export function buildHandoffPacket(
  context: HandoffContext,
  classification: ReplyClassification
): HandoffPacket {
  const positive = ["positive", "curious", "asks_for_details"].includes(
    classification.classification
  );
  const supportingEvidence = context.evidence.map((item) => `${item.claim} — ${item.sourceUrl}`);
  return handoffPacketSchema.parse({
    executiveSummary: `${context.brandName} replied from ${context.replyFrom}. The conservative classification is ${classification.classification} (${Math.round(classification.confidence * 100)}% confidence).`,
    brandAndFounder: `${context.brandName}; ${
      context.founderNames.length === 0 ? "founder not verified" : context.founderNames.join(", ")
    }.`,
    product: context.product ?? "Product detail is still incomplete.",
    stage: context.stage,
    whyContacted:
      context.discoverySignal ?? "The lead met the stored ICP and evidence gates before outreach.",
    messageHistory: [...context.messageHistory],
    replySummary: context.replyBody.slice(0, 2_000) || "The visible reply body is empty.",
    qualification: {
      decisionMaker: context.founderNames.length > 0 ? "likely" : "unknown",
      productFit: context.product === null ? "unknown" : "possible",
      activeNeed: positive ? "inferred" : "unknown",
      callWillingness:
        classification.classification === "positive"
          ? "possible"
          : classification.classification === "no_interest"
            ? "no"
            : "unknown",
      auditFeasibility: positive ? "possible" : "unknown",
      urgency: classification.classification === "positive" ? "medium" : "unknown"
    },
    primaryOpportunity:
      context.opportunity ??
      "Validate the primary product, positioning, and go-to-market gap on a call.",
    supportingEvidence,
    callQuestions: [
      "What has changed most in the project during the last 90 days?",
      "Which product or commercial decision is currently blocking progress?",
      "Who owns product, brand, ecommerce, and acquisition decisions today?",
      "What evidence do you already have from customers or sales?",
      "Which launch or growth milestone matters next?",
      "What has already been tried, and what did it teach you?",
      "What constraints exist around budget, timing, production, or team capacity?",
      "Would a prioritized cross-functional roadmap be useful after this conversation?"
    ],
    suggestedReply: suggestedReply(context, classification),
    auditAngle:
      "If several connected product, brand, operations, and growth decisions remain unresolved, explore whether the Food Brand Audit can turn them into one prioritized roadmap. Do not pitch before discovery.",
    risks: [
      "The reply classification is a conservative proposal and requires Mateo's judgment.",
      ...(supportingEvidence.length === 0 ? ["Public supporting evidence is incomplete."] : []),
      ...(classification.confidence < 0.8
        ? ["Intent is ambiguous; do not infer buying intent from politeness."]
        : [])
    ],
    directLinks: Array.from(new Set(context.evidence.map((item) => item.sourceUrl)))
  });
}
