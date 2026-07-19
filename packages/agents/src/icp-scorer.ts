import {
  calculateIcpTotal,
  deriveIcpRecommendedAction,
  icpAssessmentInputSchema,
  icpScoreResultSchema,
  type IcpAssessmentInput,
  type IcpScoreResult
} from "@innovateats/shared";

export function scoreIcpAssessment(rawInput: IcpAssessmentInput): IcpScoreResult {
  const input = icpAssessmentInputSchema.parse(rawInput);
  const total = calculateIcpTotal(input.breakdown);

  return icpScoreResultSchema.parse({
    ...input,
    total,
    recommendedAction: deriveIcpRecommendedAction(input, total)
  });
}
