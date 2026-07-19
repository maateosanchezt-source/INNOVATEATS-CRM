import { z } from "zod";

import { normalizePublicUrl } from "./crm.js";

export const contactChannelTypes = [
  "named_business_email",
  "corporate_email",
  "contact_form",
  "linkedin",
  "instagram",
  "platform_application"
] as const;
export const contactChannelTypeSchema = z.enum(contactChannelTypes);
export type ContactChannelType = z.infer<typeof contactChannelTypeSchema>;

export const contactOrigins = [
  "published_public",
  "verification_provider",
  "data_broker",
  "inferred_pattern",
  "manual"
] as const;
export const contactOriginSchema = z.enum(contactOrigins);
export type ContactOrigin = z.infer<typeof contactOriginSchema>;

export const contactVerificationStatuses = [
  "unverified",
  "published_verified",
  "syntax_valid",
  "mx_valid",
  "provider_verified",
  "risky",
  "invalid",
  "manual_review"
] as const;
export const contactVerificationStatusSchema = z.enum(contactVerificationStatuses);
export type ContactVerificationStatus = z.infer<typeof contactVerificationStatusSchema>;

export const publicDocumentLinkSchema = z.object({
  kind: z.enum(["anchor", "form", "mailto"]),
  href: z.string().trim().min(1).max(2_048),
  label: z.string().trim().max(500)
});
export type PublicDocumentLink = z.infer<typeof publicDocumentLinkSchema>;

export const contactCandidateSchema = z
  .object({
    founderId: z.uuid().nullable().default(null),
    fullName: z.string().trim().min(1).max(120).nullable().default(null),
    role: z.string().trim().min(1).max(120).nullable().default(null),
    channelType: contactChannelTypeSchema,
    value: z.string().trim().min(1).max(2_048),
    directUrl: z.string().trim().min(1).max(2_048),
    sourceUrl: z.string().trim().min(1).max(2_048),
    sourceDocumentId: z.uuid(),
    evidenceId: z.uuid(),
    origin: contactOriginSchema,
    provenance: z.string().trim().min(1).max(500),
    verificationStatus: contactVerificationStatusSchema,
    verificationProvider: z.string().trim().min(1).max(120).nullable().default(null),
    isPersonalData: z.boolean().default(false),
    country: z.string().trim().min(2).max(80).nullable().default(null),
    confidence: z.number().min(0).max(1)
  })
  .superRefine((candidate, context) => {
    try {
      normalizePublicUrl(candidate.sourceUrl);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Contact source URL must be a public HTTP or HTTPS URL.",
        path: ["sourceUrl"]
      });
    }

    const isEmail =
      candidate.channelType === "named_business_email" ||
      candidate.channelType === "corporate_email";
    if (isEmail) {
      if (!z.email().safeParse(candidate.value).success) {
        context.addIssue({
          code: "custom",
          message: "Email contact value must be a valid email address.",
          path: ["value"]
        });
      }
      if (candidate.directUrl.toLowerCase() !== `mailto:${candidate.value.toLowerCase()}`) {
        context.addIssue({
          code: "custom",
          message: "Email direct URL must be the exact mailto address.",
          path: ["directUrl"]
        });
      }
    } else {
      try {
        normalizePublicUrl(candidate.value);
        normalizePublicUrl(candidate.directUrl);
      } catch {
        context.addIssue({
          code: "custom",
          message: "Non-email contact values must be public HTTP or HTTPS URLs.",
          path: ["value"]
        });
      }
    }

    if (
      candidate.origin === "inferred_pattern" &&
      (candidate.verificationStatus === "published_verified" ||
        candidate.verificationStatus === "provider_verified")
    ) {
      context.addIssue({
        code: "custom",
        message: "An inferred contact can never be treated as verified.",
        path: ["verificationStatus"]
      });
    }
    if (
      candidate.origin === "data_broker" &&
      candidate.verificationStatus === "provider_verified" &&
      candidate.verificationProvider === null
    ) {
      context.addIssue({
        code: "custom",
        message: "A data-broker contact requires a named verification provider.",
        path: ["verificationProvider"]
      });
    }
  });
export type ContactCandidate = z.infer<typeof contactCandidateSchema>;

export const contactResearchOutputSchema = z.object({
  contacts: z.array(contactCandidateSchema).max(100),
  warnings: z.array(z.string().trim().min(1).max(500)).max(30)
});
export type ContactResearchOutput = z.infer<typeof contactResearchOutputSchema>;

export const emailProviderVerdicts = ["verified", "invalid", "risky", "unknown"] as const;
export const emailProviderVerdictSchema = z.enum(emailProviderVerdicts);
export type EmailProviderVerdict = z.infer<typeof emailProviderVerdictSchema>;

export const emailVerificationResultSchema = z
  .object({
    email: z.string().trim().min(1).max(320),
    normalizedEmail: z.string().trim().min(1).max(320),
    domain: z.string().trim().max(253),
    syntaxValid: z.boolean(),
    mxFound: z.boolean(),
    provider: z.string().trim().min(1).max(120).nullable(),
    providerVerdict: emailProviderVerdictSchema,
    status: contactVerificationStatusSchema,
    reason: z.string().trim().min(1).max(500),
    checkedAt: z.iso.datetime({ offset: true })
  })
  .superRefine((result, context) => {
    if (
      result.syntaxValid &&
      (!z.email().safeParse(result.normalizedEmail).success || result.domain.length < 3)
    ) {
      context.addIssue({
        code: "custom",
        message: "A syntax-valid result requires a normalized email and domain.",
        path: ["normalizedEmail"]
      });
    }
    if (result.status === "provider_verified" && result.provider === null) {
      context.addIssue({
        code: "custom",
        message: "Provider-verified status requires a provider.",
        path: ["provider"]
      });
    }
    if (result.status === "provider_verified" && result.providerVerdict !== "verified") {
      context.addIssue({
        code: "custom",
        message: "Provider-verified status requires a verified provider verdict.",
        path: ["providerVerdict"]
      });
    }
  });
export type EmailVerificationResult = z.infer<typeof emailVerificationResultSchema>;

export function normalizeContactValue(channel: ContactChannelType, value: string): string {
  if (channel === "named_business_email" || channel === "corporate_email") {
    return value.trim().toLowerCase();
  }
  return normalizePublicUrl(value).url;
}

export function contactIsActionable(
  origin: ContactOrigin,
  status: ContactVerificationStatus
): boolean {
  if (origin === "inferred_pattern") {
    return false;
  }
  if (origin === "data_broker") {
    return status === "provider_verified";
  }
  return status === "published_verified" || status === "provider_verified";
}
