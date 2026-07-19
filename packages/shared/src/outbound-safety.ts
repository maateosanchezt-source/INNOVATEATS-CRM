import { INNOVATEATS_WEBSITE } from "./constants.js";
import { normalizeFeatureFlags, type FeatureFlagKey } from "./feature-flags.js";

export const policyDecisions = ["allow", "approval_required", "draft_only", "block"] as const;
export type PolicyDecision = (typeof policyDecisions)[number];

export const approvalStatuses = ["not_required", "pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof approvalStatuses)[number];

export type OutboundBlockReason =
  | "autonomous_send_disabled"
  | "email_send_disabled"
  | "global_dry_run_active"
  | "idempotency_key_missing"
  | "kill_switch_active"
  | "policy_block"
  | "policy_draft_only"
  | "approval_missing"
  | "recipient_suppressed"
  | "required_website_missing";

export interface OutboundSafetyInput {
  readonly flags: Readonly<Partial<Record<FeatureFlagKey, boolean>>>;
  readonly killSwitchActive: boolean;
  readonly recipientSuppressed: boolean;
  readonly policyDecision: PolicyDecision;
  readonly approvalStatus: ApprovalStatus;
  readonly idempotencyKey: string;
  readonly messageBody: string;
  readonly autonomous: boolean;
}

export interface OutboundSafetyDecision {
  readonly allowed: boolean;
  readonly reasons: readonly OutboundBlockReason[];
}

export function containsRequiredInnovatEatsWebsite(body: string): boolean {
  const candidates = body.match(/https:\/\/[^\s<>"']+/giu) ?? [];

  return candidates.some((candidate) => {
    try {
      const url = new URL(candidate);
      return (
        url.protocol === "https:" &&
        url.hostname === "innovateats.com" &&
        url.port === "" &&
        url.username === "" &&
        url.password === ""
      );
    } catch {
      return false;
    }
  });
}

export function evaluateOutboundSafety(input: OutboundSafetyInput): OutboundSafetyDecision {
  const flags = normalizeFeatureFlags(input.flags);
  const reasons: OutboundBlockReason[] = [];

  if (flags.global_dry_run) {
    reasons.push("global_dry_run_active");
  }
  if (!flags.email_send_enabled) {
    reasons.push("email_send_disabled");
  }
  if (input.autonomous && !flags.autonomous_send_enabled) {
    reasons.push("autonomous_send_disabled");
  }
  if (input.killSwitchActive) {
    reasons.push("kill_switch_active");
  }
  if (input.recipientSuppressed) {
    reasons.push("recipient_suppressed");
  }
  if (input.policyDecision === "block") {
    reasons.push("policy_block");
  }
  if (input.policyDecision === "draft_only") {
    reasons.push("policy_draft_only");
  }
  if (input.policyDecision === "approval_required" && input.approvalStatus !== "approved") {
    reasons.push("approval_missing");
  }
  if (input.idempotencyKey.trim().length === 0) {
    reasons.push("idempotency_key_missing");
  }
  if (!containsRequiredInnovatEatsWebsite(input.messageBody)) {
    reasons.push("required_website_missing");
  }

  return {
    allowed: reasons.length === 0,
    reasons
  };
}

export function requiredWebsiteFooter(): string {
  return `InnovatEats — ${INNOVATEATS_WEBSITE}`;
}
