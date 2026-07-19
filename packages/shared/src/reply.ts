import { z } from "zod";

export const replyClassifications = [
  "positive",
  "curious",
  "asks_for_details",
  "referral",
  "later",
  "no_interest",
  "unsubscribe",
  "out_of_office",
  "wrong_person",
  "bounce",
  "hostile",
  "complaint",
  "ambiguous"
] as const;
export const replyClassificationNameSchema = z.enum(replyClassifications);
export type ReplyClassificationName = z.infer<typeof replyClassificationNameSchema>;

export const replyRequestedActions = [
  "handoff",
  "follow_up_later",
  "suppress",
  "archive",
  "manual_review",
  "update_contact"
] as const;
export const replyRequestedActionSchema = z.enum(replyRequestedActions);
export type ReplyRequestedAction = z.infer<typeof replyRequestedActionSchema>;

export const replyClassificationSchema = z
  .object({
    classification: replyClassificationNameSchema,
    confidence: z.number().min(0).max(1),
    sentiment: z.enum(["positive", "neutral", "negative", "automated"]),
    requestedAction: replyRequestedActionSchema,
    suppressionRequired: z.boolean(),
    followUpDate: z.iso.date().nullable(),
    evidenceSnippets: z.array(z.string().trim().min(1).max(500)).max(10)
  })
  .superRefine((value, context) => {
    if (
      ["unsubscribe", "complaint", "bounce"].includes(value.classification) &&
      !value.suppressionRequired
    ) {
      context.addIssue({
        code: "custom",
        message: `${value.classification} must require suppression.`,
        path: ["suppressionRequired"]
      });
    }
    if (value.requestedAction === "follow_up_later" && value.followUpDate === null) {
      context.addIssue({
        code: "custom",
        message: "A dated follow-up action requires followUpDate.",
        path: ["followUpDate"]
      });
    }
  });
export type ReplyClassification = z.infer<typeof replyClassificationSchema>;

export const inboundMessageSchema = z.object({
  providerMessageId: z.string().trim().min(1).max(512),
  threadId: z.string().trim().min(1).max(512),
  fromAddress: z.email(),
  toAddress: z.email(),
  subject: z.string().trim().max(998),
  bodyText: z.string().max(50_000),
  receivedAt: z.iso.datetime({ offset: true }),
  headers: z.record(z.string(), z.string()).default({})
});
export type InboundMessage = z.infer<typeof inboundMessageSchema>;

export const handoffPacketSchema = z.object({
  executiveSummary: z.string().trim().min(1).max(2_000),
  brandAndFounder: z.string().trim().min(1).max(1_000),
  product: z.string().trim().min(1).max(1_000),
  stage: z.string().trim().min(1).max(120),
  whyContacted: z.string().trim().min(1).max(2_000),
  messageHistory: z.array(z.string().trim().min(1).max(5_000)).max(20),
  replySummary: z.string().trim().min(1).max(2_000),
  qualification: z.object({
    decisionMaker: z.enum(["yes", "likely", "unknown", "no"]),
    productFit: z.enum(["strong", "possible", "weak", "unknown"]),
    activeNeed: z.enum(["explicit", "inferred", "none", "unknown"]),
    callWillingness: z.enum(["yes", "possible", "no", "unknown"]),
    auditFeasibility: z.enum(["strong", "possible", "weak", "unknown"]),
    urgency: z.enum(["high", "medium", "low", "unknown"])
  }),
  primaryOpportunity: z.string().trim().min(1).max(2_000),
  supportingEvidence: z.array(z.string().trim().min(1).max(2_000)).max(20),
  callQuestions: z.array(z.string().trim().min(1).max(500)).length(8),
  suggestedReply: z.string().trim().min(1).max(5_000),
  auditAngle: z.string().trim().min(1).max(2_000),
  risks: z.array(z.string().trim().min(1).max(1_000)).max(20),
  directLinks: z.array(z.url()).max(20)
});
export type HandoffPacket = z.infer<typeof handoffPacketSchema>;

export const replyPriority: Readonly<Record<ReplyClassificationName, number>> = {
  positive: 1,
  asks_for_details: 1,
  curious: 1,
  referral: 2,
  later: 3,
  no_interest: 4,
  wrong_person: 4,
  ambiguous: 4,
  out_of_office: 5,
  hostile: 6,
  complaint: 6,
  unsubscribe: 6,
  bounce: 6
};

export function replyRequiresMateoNotification(classification: ReplyClassificationName): boolean {
  return replyPriority[classification] <= 3;
}
