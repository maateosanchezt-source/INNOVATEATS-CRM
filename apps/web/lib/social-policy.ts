import type { SafetySnapshot } from "@innovateats/feature-flags";

export interface SocialManualGate {
  readonly allowed: boolean;
  readonly reason: string;
}

export function evaluateSocialManualGate(
  environmentEnabled: boolean,
  snapshot: SafetySnapshot
): SocialManualGate {
  if (!environmentEnabled) {
    return { allowed: false, reason: "SOCIAL_MANUAL_QUEUE_ENABLED is false." };
  }
  if (!snapshot.flags.social_manual_queue_enabled) {
    return { allowed: false, reason: "The database social-manual feature flag is disabled." };
  }
  if (snapshot.globalKillSwitchActive) {
    return { allowed: false, reason: "The global kill switch is active." };
  }
  return {
    allowed: true,
    reason: "Manual draft creation is enabled; no platform action is automated."
  };
}
