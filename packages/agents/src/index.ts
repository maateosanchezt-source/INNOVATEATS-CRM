export const AGENT_EXECUTION_ENABLED_IN_PHASE_ZERO = false as const;

export interface TypedAgentProposal<TOutput> {
  readonly agentName: string;
  readonly promptVersion: string;
  readonly output: TOutput;
  readonly evidenceIds: readonly string[];
}

export { extractPublicContacts, type ContactResearchContext } from "./contact-researcher.js";
export {
  deduplicateCandidates,
  normalizeEntityName,
  type CandidateDedupeResult,
  type CandidateDuplicate
} from "./dedupe.js";
export { decideEntityResolution, entityAutoResolveThreshold } from "./entity-resolver.js";
export { scoreIcpAssessment } from "./icp-scorer.js";
export {
  buildMessageSequence,
  remapHumanEditEvidence,
  reviewMessageDraft
} from "./message-strategy.js";
export { OpenAiResearchAgents } from "./openai-research-agents.js";
export { OpenAiWebSearchProvider } from "./openai-search-provider.js";
export { buildHandoffPacket, type HandoffContext } from "./handoff.js";
export { classifyReply, extractFollowUpDate, extractVisibleReply } from "./reply-classifier.js";
