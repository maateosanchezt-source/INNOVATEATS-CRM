import type { SafetySnapshot } from "@innovateats/feature-flags";

export interface ResearchGate {
  readonly allowed: boolean;
  readonly reason: string;
}

export function evaluateResearchGate(
  environmentEnabled: boolean,
  snapshot: SafetySnapshot,
  sourceId?: string
): ResearchGate {
  if (!environmentEnabled) {
    return { allowed: false, reason: "RESEARCH_ENABLED is false." };
  }
  if (!snapshot.flags.research_enabled) {
    return { allowed: false, reason: "The database research feature flag is disabled." };
  }
  if (snapshot.globalKillSwitchActive) {
    return { allowed: false, reason: "The global kill switch is active." };
  }
  if (
    sourceId !== undefined &&
    snapshot.activeKillSwitches.some(
      (killSwitch) =>
        killSwitch.scope.type === "source" &&
        (killSwitch.scope.id === undefined || killSwitch.scope.id === sourceId)
    )
  ) {
    return { allowed: false, reason: `${sourceId} is halted by a source kill switch.` };
  }

  return { allowed: true, reason: "Research gates passed." };
}
