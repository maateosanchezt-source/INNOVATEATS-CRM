import type { SafetySnapshot } from "@innovateats/feature-flags";

export interface MessageGenerationGate {
  readonly allowed: boolean;
  readonly reason: string;
}

export function evaluateMessageGenerationGate(
  environmentEnabled: boolean,
  snapshot: SafetySnapshot,
  sourceId?: string
): MessageGenerationGate {
  if (!environmentEnabled) {
    return { allowed: false, reason: "MESSAGE_GENERATION_ENABLED is false." };
  }
  if (!snapshot.flags.message_generation_enabled) {
    return {
      allowed: false,
      reason: "The database message-generation feature flag is disabled."
    };
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
  return { allowed: true, reason: "Message-generation gates passed." };
}
