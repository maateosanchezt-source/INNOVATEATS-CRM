import type { ServerEnvironment } from "@innovateats/config";
import type { SafetySnapshot } from "@innovateats/feature-flags";
import type { GmailDeliveryMode } from "@innovateats/shared";

export interface SendPolicyDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export function evaluateSequenceSchedulingGate(
  environment: ServerEnvironment,
  safety: SafetySnapshot
): SendPolicyDecision {
  const mode: GmailDeliveryMode = environment.GMAIL_DELIVERY_MODE;
  if (safety.globalKillSwitchActive) {
    return { allowed: false, reason: "The global kill switch is active." };
  }
  if (mode === "dry_run") {
    if (!environment.GLOBAL_DRY_RUN || safety.flags.global_dry_run !== true) {
      return { allowed: false, reason: "Dry-run mode must be active in both safety layers." };
    }
    return { allowed: true, reason: "Dry run is safe: no external action will occur." };
  }
  if (
    environment.GLOBAL_DRY_RUN ||
    safety.flags.global_dry_run ||
    !environment.EMAIL_SEND_ENABLED ||
    !safety.flags.email_send_enabled
  ) {
    return { allowed: false, reason: "Both environment and database gates must allow email." };
  }
  if (mode === "sandbox") {
    if (!environment.GMAIL_SANDBOX_SEND_APPROVED) {
      return { allowed: false, reason: "Sandbox delivery needs explicit approval." };
    }
    if (
      environment.GMAIL_SANDBOX_RECIPIENT.toLowerCase() !==
      environment.AUTHORIZED_EMAIL.toLowerCase()
    ) {
      return { allowed: false, reason: "Sandbox can only deliver to the authorized user." };
    }
    return { allowed: true, reason: "Sandbox is restricted to the authorized user." };
  }
  if (!environment.PRODUCTION_SEND_APPROVED) {
    return { allowed: false, reason: "Production go-live approval is absent." };
  }
  return { allowed: true, reason: "Production gates are explicitly open." };
}
