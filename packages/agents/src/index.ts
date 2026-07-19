export const AGENT_EXECUTION_ENABLED_IN_PHASE_ZERO = false as const;

export interface TypedAgentProposal<TOutput> {
  readonly agentName: string;
  readonly promptVersion: string;
  readonly output: TOutput;
  readonly evidenceIds: readonly string[];
}
