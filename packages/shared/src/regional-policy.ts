import { z } from "zod";

import { INNOVATEATS_WEBSITE, MAX_SEQUENCE_TOUCHES } from "./constants.js";

export const regionalPolicyModes = [
  "draft_only",
  "approval_required",
  "autonomous_allowlist",
  "block"
] as const;
export const regionalPolicyModeSchema = z.enum(regionalPolicyModes);
export type RegionalPolicyMode = z.infer<typeof regionalPolicyModeSchema>;

export const complianceDecisions = ["allow", "approval_required", "draft_only", "block"] as const;
export const complianceDecisionSchema = z.enum(complianceDecisions);
export type ComplianceDecisionName = z.infer<typeof complianceDecisionSchema>;

export const outreachChannels = [
  "email",
  "linkedin",
  "instagram",
  "kickstarter",
  "indiegogo",
  "upwork"
] as const;
export const outreachChannelSchema = z.enum(outreachChannels);
export type OutreachChannel = z.infer<typeof outreachChannelSchema>;

export const subscriberTypes = [
  "corporate",
  "sole_trader",
  "partnership",
  "individual",
  "unknown"
] as const;
export const subscriberTypeSchema = z.enum(subscriberTypes);
export type SubscriberType = z.infer<typeof subscriberTypeSchema>;

export const consentStatuses = [
  "express",
  "inferred",
  "prior_relationship",
  "none",
  "unknown"
] as const;
export const consentStatusSchema = z.enum(consentStatuses);
export type ConsentStatus = z.infer<typeof consentStatusSchema>;

export const languageProficiencies = ["native", "high", "unknown"] as const;
export const languageProficiencySchema = z.enum(languageProficiencies);
export type LanguageProficiency = z.infer<typeof languageProficiencySchema>;

export const footerRequirements = [
  "accurate_identity",
  "business_contact_email",
  "innovateats_website",
  "easy_opt_out",
  "physical_postal_address",
  "advertisement_disclosure",
  "formal_unsubscribe"
] as const;
export const footerRequirementSchema = z.enum(footerRequirements);
export type FooterRequirement = z.infer<typeof footerRequirementSchema>;

export const policySourceSchema = z.object({
  authority: z.string().min(1),
  url: z.url(),
  checkedAt: z.iso.date()
});
export type PolicySource = z.infer<typeof policySourceSchema>;

export const regionPolicySchema = z.object({
  code: z.string().min(2),
  name: z.string().min(2),
  version: z.string().min(1),
  effectiveFrom: z.iso.date(),
  defaultLanguage: z.enum(["en", "es"]),
  supportedLanguages: z.array(z.enum(["en", "es"])).min(1),
  timezoneStrategy: z.literal("recipient_local"),
  policyMode: regionalPolicyModeSchema,
  channelModes: z.record(outreachChannelSchema, regionalPolicyModeSchema),
  sendWindow: z.object({
    weekdays: z.array(z.number().int().min(1).max(7)).min(1),
    start: z.string().regex(/^\d{2}:\d{2}$/u),
    end: z.string().regex(/^\d{2}:\d{2}$/u)
  }),
  maximumTouches: z.number().int().min(1).max(MAX_SEQUENCE_TOUCHES),
  footerRequirements: z.array(footerRequirementSchema).min(4),
  retentionDays: z.object({
    rejectedUncontacted: z.number().int().positive(),
    contacted: z.number().int().positive(),
    policySnapshots: z.number().int().positive()
  }),
  rules: z.array(z.string().min(1)).min(1),
  sources: z.array(policySourceSchema).min(1)
});
export type RegionPolicy = z.infer<typeof regionPolicySchema>;

export const complianceInputSchema = z.object({
  regionCode: z.string().nullable(),
  regionEnabled: z.boolean(),
  channel: outreachChannelSchema,
  subscriberType: subscriberTypeSchema,
  consentStatus: consentStatusSchema,
  isPersonalData: z.boolean(),
  doNotContact: z.boolean(),
  suppressed: z.boolean(),
  contactOrigin: z.enum([
    "public_exact",
    "provider_exact",
    "manual",
    "inferred_pattern",
    "unknown"
  ]),
  requestedLanguage: z.enum(["en", "es"]),
  languageProficiency: languageProficiencySchema,
  businessPostalAddressConfigured: z.boolean(),
  touchesAlreadySent: z.number().int().nonnegative().default(0),
  hasHumanReply: z.boolean().default(false)
});
export type ComplianceInput = z.infer<typeof complianceInputSchema>;

export const complianceDecisionResultSchema = z.object({
  decision: complianceDecisionSchema,
  reasons: z.array(z.string().min(1)).min(1),
  legalBasisTag: z.string().min(1),
  policyCode: z.string().min(2),
  policyVersion: z.string().min(1),
  effectiveLanguage: z.enum(["en", "es"]),
  manualActionRequired: z.boolean(),
  footerRequirements: z.array(footerRequirementSchema).min(4),
  maximumTouches: z.number().int().min(1).max(MAX_SEQUENCE_TOUCHES),
  sendWindow: regionPolicySchema.shape.sendWindow,
  requiredWebsite: z.literal(INNOVATEATS_WEBSITE)
});
export type ComplianceDecisionResult = z.infer<typeof complianceDecisionResultSchema>;

const universalFooterRequirements = [
  "accurate_identity",
  "business_contact_email",
  "innovateats_website",
  "easy_opt_out"
] as const satisfies readonly FooterRequirement[];

export function resolveRegionalLanguage(
  policy: RegionPolicy,
  requestedLanguage: "en" | "es",
  proficiency: LanguageProficiency
): "en" | "es" {
  if (
    requestedLanguage === "es" &&
    policy.supportedLanguages.includes("es") &&
    (proficiency === "native" || proficiency === "high")
  ) {
    return "es";
  }
  return "en";
}

function result(
  policy: RegionPolicy,
  input: ComplianceInput,
  decision: ComplianceDecisionName,
  legalBasisTag: string,
  reasons: readonly string[]
): ComplianceDecisionResult {
  const requirements = new Set<FooterRequirement>([
    ...universalFooterRequirements,
    ...policy.footerRequirements
  ]);
  return complianceDecisionResultSchema.parse({
    decision,
    reasons,
    legalBasisTag,
    policyCode: policy.code,
    policyVersion: policy.version,
    effectiveLanguage: resolveRegionalLanguage(
      policy,
      input.requestedLanguage,
      input.languageProficiency
    ),
    manualActionRequired: decision !== "allow",
    footerRequirements: [...requirements],
    maximumTouches: policy.maximumTouches,
    sendWindow: policy.sendWindow,
    requiredWebsite: INNOVATEATS_WEBSITE
  });
}

export function evaluateRegionalPolicy(
  policy: RegionPolicy,
  rawInput: ComplianceInput
): ComplianceDecisionResult {
  const input = complianceInputSchema.parse(rawInput);
  if (input.doNotContact) {
    return result(policy, input, "block", "suppression", ["Contact is marked do-not-contact."]);
  }
  if (input.suppressed) {
    return result(policy, input, "block", "suppression", ["Contact is on the suppression list."]);
  }
  if (input.hasHumanReply) {
    return result(policy, input, "block", "human_reply", [
      "A human reply exists; automated follow-up must stop."
    ]);
  }
  if (input.touchesAlreadySent >= policy.maximumTouches) {
    return result(policy, input, "block", "frequency_cap", [
      `The policy maximum of ${policy.maximumTouches} touches has been reached.`
    ]);
  }
  if (input.contactOrigin === "inferred_pattern" || input.contactOrigin === "unknown") {
    return result(policy, input, "block", "provenance", [
      "Only an exact, provenance-backed public or provider-verified contact may be used."
    ]);
  }
  if (input.regionCode === null || input.regionCode !== policy.code) {
    return result(policy, input, "block", "unknown_region", [
      "The contact has no matching country policy."
    ]);
  }
  if (input.channel !== "email") {
    return result(policy, input, "draft_only", "platform_manual_only", [
      "Platform outreach is manual only: copy the draft, open the direct URL, and let Mateo act."
    ]);
  }
  if (!input.regionEnabled) {
    return result(policy, input, "draft_only", "region_disabled", [
      "The region is disabled; only an internal draft or dry run is permitted."
    ]);
  }

  if (policy.code === "US") {
    if (!input.businessPostalAddressConfigured) {
      return result(policy, input, "draft_only", "can_spam_missing_postal_address", [
        "A valid physical postal address is required before US commercial email can be approved."
      ]);
    }
    return result(policy, input, "approval_required", "can_spam", [
      "US B2B email requires accurate identity, advertising disclosure, postal address and opt-out.",
      "Mateo must approve the exact message before any external send."
    ]);
  }

  if (policy.code === "UK") {
    if (
      input.subscriberType !== "corporate" &&
      input.consentStatus !== "express" &&
      input.consentStatus !== "prior_relationship"
    ) {
      return result(policy, input, "block", "uk_pecr_individual_subscriber", [
        "Sole traders, some partnerships, individuals and unknown subscribers require consent or a documented prior relationship."
      ]);
    }
    return result(policy, input, "approval_required", "uk_pecr_corporate_b2b", [
      "The recipient type and lawful basis require Mateo review; identity and opt-out remain mandatory."
    ]);
  }

  if (policy.code === "AU_NZ") {
    if (!["express", "inferred", "prior_relationship"].includes(input.consentStatus)) {
      return result(policy, input, "block", "au_nz_consent_missing", [
        "Documented express, inferred or prior-relationship consent is required."
      ]);
    }
    return result(policy, input, "draft_only", "au_nz_manual_legal_review", [
      "Australia and New Zealand remain draft-only until the country-specific basis is reviewed."
    ]);
  }

  if (policy.code === "ES") {
    return result(policy, input, "draft_only", "es_lssi_manual_review", [
      input.isPersonalData
        ? "Named personal data requires a documented lawful-basis review."
        : "A generic corporate address still requires manual LSSI review.",
      "No autonomous email is permitted."
    ]);
  }

  if (policy.code === "CENTRAL_EU") {
    return result(policy, input, "draft_only", "eu_country_adapter_required", [
      "The destination country and legitimate-interest assessment must be reviewed manually.",
      "No named-person outreach may be autonomous."
    ]);
  }

  if (policy.code === "ASIA") {
    return result(policy, input, "draft_only", "asia_country_adapter_required", [
      "A country-specific electronic-marketing adapter is required before external outreach."
    ]);
  }

  return result(policy, input, policy.policyMode === "block" ? "block" : "draft_only", "fallback", [
    "No explicit allow rule exists; fail closed to a manual draft."
  ]);
}
