import { z } from "zod";

export const leadStages = [
  "idea",
  "prelaunch",
  "crowdfunding",
  "first_production",
  "first_sales",
  "early_growth",
  "mature",
  "unknown"
] as const;

export const leadStageSchema = z.enum(leadStages);
export type LeadStage = z.infer<typeof leadStageSchema>;

export const leadStatuses = [
  "discovered",
  "entity_resolved",
  "researched",
  "scored",
  "contact_found",
  "message_drafted",
  "qa_passed",
  "approval_pending",
  "scheduled",
  "contacted",
  "follow_up_wait",
  "responded",
  "handoff_ready",
  "mateo_owned",
  "rejected_icp",
  "no_contact",
  "blocked_policy",
  "suppressed",
  "no_response_nurture",
  "not_interested",
  "invalid",
  "duplicate"
] as const;

export const leadStatusSchema = z.enum(leadStatuses);
export type LeadStatus = z.infer<typeof leadStatusSchema>;

export const terminalLeadStatuses = [
  "mateo_owned",
  "rejected_icp",
  "suppressed",
  "no_response_nurture",
  "not_interested",
  "invalid",
  "duplicate"
] as const satisfies readonly LeadStatus[];

const allowedLeadTransitions: Readonly<Record<LeadStatus, readonly LeadStatus[]>> = {
  discovered: ["entity_resolved", "invalid", "duplicate"],
  entity_resolved: ["researched", "invalid", "duplicate"],
  researched: ["scored", "no_contact", "invalid", "duplicate"],
  scored: ["contact_found", "rejected_icp", "no_contact", "blocked_policy"],
  contact_found: ["message_drafted", "no_contact", "blocked_policy", "suppressed"],
  message_drafted: ["qa_passed", "blocked_policy", "suppressed"],
  qa_passed: ["approval_pending", "blocked_policy", "suppressed"],
  approval_pending: ["scheduled", "message_drafted", "blocked_policy", "suppressed"],
  scheduled: ["contacted", "responded", "blocked_policy", "suppressed"],
  contacted: ["follow_up_wait", "responded", "suppressed"],
  follow_up_wait: ["contacted", "responded", "no_response_nurture", "suppressed"],
  responded: ["handoff_ready", "not_interested", "suppressed"],
  handoff_ready: ["mateo_owned", "suppressed"],
  mateo_owned: ["suppressed"],
  rejected_icp: ["discovered"],
  no_contact: ["researched", "contact_found"],
  blocked_policy: ["scored", "contact_found"],
  suppressed: [],
  no_response_nurture: ["discovered", "responded", "suppressed"],
  not_interested: [],
  invalid: ["discovered"],
  duplicate: []
};

export function allowedTransitionsFrom(status: LeadStatus): readonly LeadStatus[] {
  return allowedLeadTransitions[status];
}

export function canTransitionLead(from: LeadStatus, to: LeadStatus): boolean {
  return from === to || allowedLeadTransitions[from].includes(to);
}

const optionalTrimmedString = (maximum: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(maximum).optional()
  );

export const manualLeadIngestSchema = z.object({
  sourceUrl: z.string().trim().min(1).max(2_048),
  brandName: z.string().trim().min(1).max(120),
  productSummary: optionalTrimmedString(500),
  country: z.string().trim().min(2).max(80).default("Unknown"),
  regionCode: optionalTrimmedString(32),
  stage: leadStageSchema.default("unknown"),
  discoverySignal: optionalTrimmedString(500),
  preliminaryScore: z.coerce.number().int().min(0).max(100).default(0)
});

export type ManualLeadIngestInput = z.infer<typeof manualLeadIngestSchema>;

export const evidenceInputSchema = z.object({
  factType: z.string().trim().min(1).max(80),
  claim: z.string().trim().min(1).max(500),
  quoteOrSummary: z.string().trim().min(1).max(2_000),
  sourceUrl: z.string().trim().min(1).max(2_048),
  observedAt: z.iso.datetime({ offset: true }).optional(),
  confidence: z.coerce.number().min(0).max(1),
  isInference: z.boolean().default(false)
});

export type EvidenceInput = z.infer<typeof evidenceInputSchema>;

export const leadUpdateSchema = z
  .object({
    status: leadStatusSchema.optional(),
    currentOwner: optionalTrimmedString(120).nullable(),
    nextActionAt: z.iso.datetime({ offset: true }).nullable().optional(),
    reason: optionalTrimmedString(500)
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.currentOwner !== undefined ||
      value.nextActionAt !== undefined,
    "At least one lead field must be updated."
  );

export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;

export interface NormalizedPublicUrl {
  readonly url: string;
  readonly domain: string;
}

const reservedHostSuffixes = [
  ".example",
  ".internal",
  ".invalid",
  ".local",
  ".localhost",
  ".test"
] as const;

export function normalizePublicUrl(input: string): NormalizedPublicUrl {
  const url = new URL(input.trim());
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only public HTTP or HTTPS URLs are accepted.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("URLs containing credentials are not accepted.");
  }
  if (
    hostname === "localhost" ||
    !hostname.includes(".") ||
    hostname.includes(":") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname) ||
    reservedHostSuffixes.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error("A public domain name is required.");
  }

  url.hostname = hostname;
  url.hash = "";
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  return {
    url: url.toString(),
    domain: hostname.replace(/^www\./u, "")
  };
}
