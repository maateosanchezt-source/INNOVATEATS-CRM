import { z } from "zod";

import { INNOVATEATS_WEBSITE } from "./constants.js";

export const messageSequenceSteps = [1, 2, 3] as const;
export const messageSequenceStepSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type MessageSequenceStep = z.infer<typeof messageSequenceStepSchema>;

export const messageLanguages = ["en", "es"] as const;
export const messageLanguageSchema = z.enum(messageLanguages);
export type MessageLanguage = z.infer<typeof messageLanguageSchema>;

export const mateoCredentialKeys = [
  "chef_rd",
  "ecommerce_operator",
  "paid_media_200k",
  "integrated_operator",
  "external_specialist_coordination"
] as const;
export const mateoCredentialKeySchema = z.enum(mateoCredentialKeys);
export type MateoCredentialKey = z.infer<typeof mateoCredentialKeySchema>;

export const messageEvidenceKinds = ["fact", "inference", "credential", "offer", "cta"] as const;
export const messageEvidenceKindSchema = z.enum(messageEvidenceKinds);
export type MessageEvidenceKind = z.infer<typeof messageEvidenceKindSchema>;

export const messageEvidenceMapItemSchema = z
  .object({
    textSpan: z.string().trim().min(1).max(1_000),
    kind: messageEvidenceKindSchema,
    evidenceIds: z.array(z.uuid()).max(20).default([])
  })
  .superRefine((item, context) => {
    if (item.kind === "fact" && item.evidenceIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A factual message span requires evidence IDs.",
        path: ["evidenceIds"]
      });
    }
    if (item.kind !== "fact" && item.evidenceIds.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Only factual spans cite lead evidence.",
        path: ["evidenceIds"]
      });
    }
  });
export type MessageEvidenceMapItem = z.infer<typeof messageEvidenceMapItemSchema>;

export const messageBriefSchema = z.object({
  contactId: z.uuid(),
  language: messageLanguageSchema,
  contactFirstName: z.string().trim().min(1).max(80).nullable().default(null),
  brandName: z.string().trim().min(1).max(120),
  productDescription: z.string().trim().min(3).max(240),
  discoveryFact: z.string().trim().min(3).max(300),
  specificOpportunity: z.string().trim().min(3).max(300),
  nextExecutionStep: z.string().trim().min(3).max(160),
  opportunityType: z.enum(["product", "ecommerce", "integrated", "cultural", "paid_launch"]),
  selectedCredentials: z.array(mateoCredentialKeySchema).min(1).max(2),
  evidenceIds: z.array(z.uuid()).min(1).max(20)
});
export type MessageBrief = z.infer<typeof messageBriefSchema>;

export function countMessageWords(value: string): number {
  return value.trim() === "" ? 0 : value.trim().split(/\s+/u).length;
}

function wordBoundsForStep(step: MessageSequenceStep): readonly [number, number] {
  if (step === 1) {
    return [90, 160];
  }
  return step === 2 ? [35, 70] : [25, 55];
}

export const messageDraftContentSchema = z
  .object({
    channel: z.literal("email"),
    sequenceStep: messageSequenceStepSchema,
    subject: z.string().trim().min(1).max(120).nullable(),
    body: z.string().trim().min(1).max(5_000),
    language: messageLanguageSchema,
    personalizationTokens: z.array(z.string().trim().min(1).max(120)).min(2).max(20),
    evidenceMap: z.array(messageEvidenceMapItemSchema).min(1).max(30),
    wordCount: z.number().int().positive()
  })
  .superRefine((draft, context) => {
    const counted = countMessageWords(draft.body);
    if (draft.wordCount !== counted) {
      context.addIssue({
        code: "custom",
        message: `Word count must equal the body count (${counted}).`,
        path: ["wordCount"]
      });
    }
    const [minimum, maximum] = wordBoundsForStep(draft.sequenceStep);
    if (counted < minimum || counted > maximum) {
      context.addIssue({
        code: "custom",
        message: `Step ${draft.sequenceStep} must contain ${minimum}-${maximum} words.`,
        path: ["body"]
      });
    }
    if (!draft.body.includes(INNOVATEATS_WEBSITE)) {
      context.addIssue({
        code: "custom",
        message: `Every email must contain ${INNOVATEATS_WEBSITE}.`,
        path: ["body"]
      });
    }
    if (draft.sequenceStep === 1) {
      if (draft.subject === null) {
        context.addIssue({
          code: "custom",
          message: "The initial email requires a subject.",
          path: ["subject"]
        });
      } else {
        const subjectWords = countMessageWords(draft.subject);
        if (subjectWords < 3 || subjectWords > 8) {
          context.addIssue({
            code: "custom",
            message: "Initial subject must contain 3-8 words.",
            path: ["subject"]
          });
        }
      }
    }
    for (const item of draft.evidenceMap) {
      if (!draft.body.includes(item.textSpan)) {
        context.addIssue({
          code: "custom",
          message: "Every evidence-map span must occur exactly in the body.",
          path: ["evidenceMap"]
        });
      }
    }
  });
export type MessageDraftContent = z.infer<typeof messageDraftContentSchema>;

export const messageSequenceSchema = z
  .object({
    drafts: z.tuple([
      messageDraftContentSchema,
      messageDraftContentSchema,
      messageDraftContentSchema
    ])
  })
  .superRefine((sequence, context) => {
    if (sequence.drafts.some((draft, index) => draft.sequenceStep !== index + 1)) {
      context.addIssue({
        code: "custom",
        message: "A message sequence must contain steps 1, 2, and 3 in order.",
        path: ["drafts"]
      });
    }
  });
export type MessageSequence = z.infer<typeof messageSequenceSchema>;

export const messageQaReviewSchema = z.object({
  passed: z.boolean(),
  factualityScore: z.number().int().min(0).max(100),
  specificityScore: z.number().int().min(0).max(100),
  salesQualityScore: z.number().int().min(0).max(100),
  unsupportedClaims: z.array(z.string().trim().min(1).max(500)).max(30),
  requiredRevisions: z.array(z.string().trim().min(1).max(500)).max(30)
});
export type MessageQaReview = z.infer<typeof messageQaReviewSchema>;

export const approvalStatuses = ["pending", "approved", "rejected", "superseded"] as const;
export const messageApprovalStatusSchema = z.enum(approvalStatuses);
export type MessageApprovalStatus = z.infer<typeof messageApprovalStatusSchema>;
