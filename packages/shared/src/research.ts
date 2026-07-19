import { z } from "zod";

import { leadStageSchema } from "./crm.js";
import { publicDocumentLinkSchema } from "./contact.js";

export const researchRegionCodes = ["US", "UK", "ES", "CENTRAL_EU", "AU_NZ", "ASIA"] as const;
export const researchRegionCodeSchema = z.enum(researchRegionCodes);
export type ResearchRegionCode = z.infer<typeof researchRegionCodeSchema>;

export const publicSearchRequestSchema = z.object({
  regionCode: researchRegionCodeSchema,
  query: z.string().trim().min(3).max(500),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().trim().min(1).max(500).optional()
});
export type PublicSearchRequest = z.infer<typeof publicSearchRequestSchema>;

export const publicSearchResultSchema = z.object({
  providerResultId: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(500),
  url: z.string().trim().min(1).max(2_048),
  snippet: z.string().trim().max(2_000),
  publishedAt: z.iso.datetime({ offset: true }).optional()
});
export type PublicSearchResult = z.infer<typeof publicSearchResultSchema>;

export const publicSearchPageSchema = z.object({
  results: z.array(publicSearchResultSchema).max(50),
  nextCursor: z.string().trim().min(1).max(500).optional()
});
export type PublicSearchPage = z.infer<typeof publicSearchPageSchema>;

export const regionalCandidateSchema = z.object({
  brandName: z.string().trim().min(1).max(120),
  productOneLiner: z.string().trim().min(1).max(500),
  founder: z.string().trim().min(1).max(120).optional(),
  country: z.string().trim().min(2).max(80),
  regionCode: researchRegionCodeSchema,
  sourceUrls: z.array(z.string().trim().min(1).max(2_048)).min(1).max(10),
  discoverySignal: z.string().trim().min(1).max(500),
  stage: leadStageSchema,
  likelyTrend: z.string().trim().min(1).max(120).optional(),
  preliminaryScore: z.number().int().min(0).max(100),
  reasonToResearch: z.string().trim().min(1).max(1_000),
  duplicateKeys: z.array(z.string().trim().min(1).max(500)).max(20).default([])
});
export type RegionalCandidate = z.infer<typeof regionalCandidateSchema>;

export const regionalScoutOutputSchema = z.object({
  regionCode: researchRegionCodeSchema,
  candidates: z.array(regionalCandidateSchema).max(50),
  evidenceResultIds: z.array(z.string().trim().min(1).max(500)).max(100)
});
export type RegionalScoutOutput = z.infer<typeof regionalScoutOutputSchema>;

const founderProposalSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(120),
  publicProfileUrls: z.array(z.string().trim().min(1).max(2_048)).max(10),
  confidence: z.number().min(0).max(1)
});

export const entityResolutionProposalSchema = z.object({
  canonicalOrganization: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20),
  canonicalDomain: z.string().trim().min(3).max(253),
  founders: z.array(founderProposalSchema).max(20),
  profiles: z.array(z.string().trim().min(1).max(2_048)).max(20),
  duplicateCandidates: z.array(z.string().trim().min(1).max(500)).max(20),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string().trim().min(1).max(500)).min(1).max(100)
});
export type EntityResolutionProposal = z.infer<typeof entityResolutionProposalSchema>;

export const entityResolutionDecisionSchema = z.object({
  proposal: entityResolutionProposalSchema,
  decision: z.enum(["resolved", "manual_review"]),
  mergeAllowed: z.boolean(),
  reason: z.string().trim().min(1).max(500)
});
export type EntityResolutionDecision = z.infer<typeof entityResolutionDecisionSchema>;

export const icpRubricVersion = "icp-v1" as const;

export const icpDimensionKeys = [
  "productCategory",
  "trendFit",
  "outsourceability",
  "stage",
  "strategicGap",
  "needSignal",
  "founderAccess",
  "abilityToInvest",
  "innovateatsDifferential"
] as const;
export const icpDimensionKeySchema = z.enum(icpDimensionKeys);
export type IcpDimensionKey = z.infer<typeof icpDimensionKeySchema>;

export const icpDimensionMaximums = {
  productCategory: 15,
  trendFit: 15,
  outsourceability: 15,
  stage: 15,
  strategicGap: 10,
  needSignal: 10,
  founderAccess: 10,
  abilityToInvest: 5,
  innovateatsDifferential: 5
} as const satisfies Readonly<Record<IcpDimensionKey, number>>;

export const icpScoreBreakdownSchema = z.object({
  productCategory: z.number().int().min(0).max(15),
  trendFit: z.number().int().min(0).max(15),
  outsourceability: z.number().int().min(0).max(15),
  stage: z.number().int().min(0).max(15),
  strategicGap: z.number().int().min(0).max(10),
  needSignal: z.number().int().min(0).max(10),
  founderAccess: z.number().int().min(0).max(10),
  abilityToInvest: z.number().int().min(0).max(5),
  innovateatsDifferential: z.number().int().min(0).max(5)
});
export type IcpScoreBreakdown = z.infer<typeof icpScoreBreakdownSchema>;

const icpExplanationsSchema = z.object(
  Object.fromEntries(
    icpDimensionKeys.map((key) => [key, z.string().trim().min(1).max(1_000)])
  ) as Record<IcpDimensionKey, z.ZodString>
);

export const icpAssessmentInputSchema = z
  .object({
    rubricVersion: z.literal(icpRubricVersion),
    breakdown: icpScoreBreakdownSchema,
    explanations: icpExplanationsSchema,
    confidence: z.number().min(0).max(1),
    hardExclusion: z.boolean(),
    exclusionReason: z.string().trim().min(1).max(500).nullable(),
    missingInformation: z.array(z.string().trim().min(1).max(500)).max(30),
    evidenceIds: z.array(z.string().trim().min(1).max(500)).min(1).max(100)
  })
  .superRefine((value, context) => {
    if (value.hardExclusion && value.exclusionReason === null) {
      context.addIssue({
        code: "custom",
        message: "A hard exclusion requires an exclusion reason.",
        path: ["exclusionReason"]
      });
    }
    if (!value.hardExclusion && value.exclusionReason !== null) {
      context.addIssue({
        code: "custom",
        message: "An exclusion reason is only valid for a hard exclusion.",
        path: ["exclusionReason"]
      });
    }
  });
export type IcpAssessmentInput = z.infer<typeof icpAssessmentInputSchema>;

export const icpRecommendedActions = [
  "advance",
  "approval_required",
  "nurture",
  "archive",
  "reject_hard_exclusion",
  "manual_research"
] as const;
export const icpRecommendedActionSchema = z.enum(icpRecommendedActions);
export type IcpRecommendedAction = z.infer<typeof icpRecommendedActionSchema>;

export function calculateIcpTotal(breakdown: IcpScoreBreakdown): number {
  return icpDimensionKeys.reduce((sum, key) => sum + breakdown[key], 0);
}

export function deriveIcpRecommendedAction(
  assessment: Pick<IcpAssessmentInput, "confidence" | "hardExclusion">,
  total: number
): IcpRecommendedAction {
  if (assessment.hardExclusion) {
    return "reject_hard_exclusion";
  }
  if (assessment.confidence < 0.7) {
    return "manual_research";
  }
  if (total >= 85) {
    return "advance";
  }
  if (total >= 75) {
    return "approval_required";
  }
  if (total >= 65) {
    return "nurture";
  }
  return "archive";
}

export const icpScoreResultSchema = icpAssessmentInputSchema
  .and(
    z.object({
      total: z.number().int().min(0).max(100),
      recommendedAction: icpRecommendedActionSchema
    })
  )
  .superRefine((value, context) => {
    const expectedTotal = calculateIcpTotal(value.breakdown);
    if (value.total !== expectedTotal) {
      context.addIssue({
        code: "custom",
        message: `ICP total must equal the rubric breakdown (${expectedTotal}).`,
        path: ["total"]
      });
    }
    const expectedAction = deriveIcpRecommendedAction(value, expectedTotal);
    if (value.recommendedAction !== expectedAction) {
      context.addIssue({
        code: "custom",
        message: `ICP action must be derived from the rubric (${expectedAction}).`,
        path: ["recommendedAction"]
      });
    }
  });
export type IcpScoreResult = z.infer<typeof icpScoreResultSchema>;

export const sourceSnapshotSchema = z.object({
  requestedUrl: z.string().trim().min(1).max(2_048),
  finalUrl: z.string().trim().min(1).max(2_048),
  title: z.string().trim().max(500).nullable(),
  extractedText: z.string().max(200_000),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  contentType: z.string().trim().min(1).max(200),
  fetchedAt: z.iso.datetime({ offset: true }),
  byteLength: z.number().int().nonnegative(),
  redirectCount: z.number().int().min(0).max(5),
  resolvedAddresses: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
  robotsDecision: z.literal("allowed"),
  publicLinks: z.array(publicDocumentLinkSchema).max(200).default([])
});
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
