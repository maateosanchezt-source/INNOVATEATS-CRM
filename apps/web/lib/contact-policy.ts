import type { SafetySnapshot } from "@innovateats/feature-flags";

export interface ContactGate {
  readonly allowed: boolean;
  readonly reason: string;
}

export function evaluateContactGate(
  environmentEnabled: boolean,
  snapshot: SafetySnapshot,
  sourceId?: string
): ContactGate {
  if (!environmentEnabled) {
    return { allowed: false, reason: "CONTACT_ENRICHMENT_ENABLED is false." };
  }
  if (!snapshot.flags.contact_enrichment_enabled) {
    return {
      allowed: false,
      reason: "The database contact-enrichment feature flag is disabled."
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
  return { allowed: true, reason: "Contact-enrichment gates passed." };
}
