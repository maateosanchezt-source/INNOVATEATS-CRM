import { z } from "zod";

export const featureFlagKeys = [
  "global_dry_run",
  "research_enabled",
  "contact_enrichment_enabled",
  "message_generation_enabled",
  "email_send_enabled",
  "autonomous_send_enabled",
  "inbound_processing_enabled",
  "social_manual_queue_enabled"
] as const;

export const featureFlagKeySchema = z.enum(featureFlagKeys);
export type FeatureFlagKey = z.infer<typeof featureFlagKeySchema>;

export const defaultFeatureFlags: Readonly<Record<FeatureFlagKey, boolean>> = {
  global_dry_run: true,
  research_enabled: false,
  contact_enrichment_enabled: false,
  message_generation_enabled: false,
  email_send_enabled: false,
  autonomous_send_enabled: false,
  inbound_processing_enabled: false,
  social_manual_queue_enabled: false
};

export const killSwitchScopeTypes = ["global", "region", "source", "campaign", "sender"] as const;

export const killSwitchScopeTypeSchema = z.enum(killSwitchScopeTypes);
export type KillSwitchScopeType = z.infer<typeof killSwitchScopeTypeSchema>;

export interface KillSwitchScope {
  readonly type: KillSwitchScopeType;
  readonly id?: string;
}

export function normalizeFeatureFlags(
  values: Readonly<Partial<Record<FeatureFlagKey, boolean>>>
): Readonly<Record<FeatureFlagKey, boolean>> {
  return {
    ...defaultFeatureFlags,
    ...values
  };
}
