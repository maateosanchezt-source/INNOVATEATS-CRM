import {
  entityResolutionDecisionSchema,
  entityResolutionProposalSchema,
  normalizePublicUrl,
  type EntityResolutionDecision,
  type EntityResolutionProposal
} from "@innovateats/shared";

export const entityAutoResolveThreshold = 0.85;

export function decideEntityResolution(
  rawProposal: EntityResolutionProposal
): EntityResolutionDecision {
  const proposal = entityResolutionProposalSchema.parse(rawProposal);
  const normalizedDomain = normalizePublicUrl(`https://${proposal.canonicalDomain}`).domain;
  const domainMatches =
    normalizedDomain === proposal.canonicalDomain.toLowerCase().replace(/^www\./u, "");
  const mergeAllowed = proposal.confidence >= entityAutoResolveThreshold && domainMatches;

  return entityResolutionDecisionSchema.parse({
    proposal: {
      ...proposal,
      canonicalDomain: normalizedDomain
    },
    decision: mergeAllowed ? "resolved" : "manual_review",
    mergeAllowed,
    reason: mergeAllowed
      ? `Entity confidence ${proposal.confidence.toFixed(2)} meets the ${entityAutoResolveThreshold.toFixed(2)} threshold.`
      : `Entity confidence or canonical-domain validation did not meet the ${entityAutoResolveThreshold.toFixed(2)} auto-resolution threshold.`
  });
}
