import { regionPolicySchema, type RegionPolicy } from "./regional-policy.js";

const checkedAt = "2026-07-19";
const universalRules = [
  "Use accurate Mateo / InnovatEats identity and non-deceptive headers.",
  "Use only relevant public context with recorded provenance; never bought or harvested lists.",
  "Include https://innovateats.com and a simple opt-out in every email.",
  "Stop after a reply, suppression, do-not-contact flag, or three total touches.",
  "Retain only the minimum data needed for the documented business purpose."
];
const retentionDays = {
  rejectedUncontacted: 90,
  contacted: 730,
  policySnapshots: 180
};
const sendWindow = {
  weekdays: [2, 3, 4],
  start: "09:00",
  end: "11:30"
};
const manualChannelModes = {
  linkedin: "draft_only",
  instagram: "draft_only",
  kickstarter: "draft_only",
  indiegogo: "draft_only",
  upwork: "draft_only"
} as const;

function fixture(
  value: Omit<
    RegionPolicy,
    "effectiveFrom" | "timezoneStrategy" | "sendWindow" | "maximumTouches" | "retentionDays"
  >
): RegionPolicy {
  return regionPolicySchema.parse({
    ...value,
    effectiveFrom: checkedAt,
    timezoneStrategy: "recipient_local",
    sendWindow,
    maximumTouches: 3,
    retentionDays
  });
}

export const regionalPolicyFixtures = [
  fixture({
    code: "US",
    name: "United States",
    version: "US-2026-07-19.1",
    defaultLanguage: "en",
    supportedLanguages: ["en"],
    policyMode: "approval_required",
    channelModes: { email: "approval_required", ...manualChannelModes },
    footerRequirements: [
      "accurate_identity",
      "business_contact_email",
      "innovateats_website",
      "easy_opt_out",
      "physical_postal_address",
      "advertisement_disclosure"
    ],
    rules: [
      ...universalRules,
      "B2B email has no CAN-SPAM exemption.",
      "Honor opt-outs within 10 business days."
    ],
    sources: [
      {
        authority: "US Federal Trade Commission",
        url: "https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business",
        checkedAt
      }
    ]
  }),
  fixture({
    code: "UK",
    name: "United Kingdom",
    version: "UK-2026-07-19.1",
    defaultLanguage: "en",
    supportedLanguages: ["en"],
    policyMode: "approval_required",
    channelModes: { email: "approval_required", ...manualChannelModes },
    footerRequirements: [
      "accurate_identity",
      "business_contact_email",
      "innovateats_website",
      "easy_opt_out"
    ],
    rules: [
      ...universalRules,
      "Corporate subscribers require human review and a documented UK GDPR basis.",
      "Treat unknown subscriber types as individuals; sole traders and some partnerships need consent or a documented exception."
    ],
    sources: [
      {
        authority: "UK Information Commissioner's Office",
        url: "https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/",
        checkedAt
      }
    ]
  }),
  fixture({
    code: "ES",
    name: "Spain",
    version: "ES-2026-07-19.1",
    defaultLanguage: "es",
    supportedLanguages: ["en", "es"],
    policyMode: "draft_only",
    channelModes: { email: "draft_only", ...manualChannelModes },
    footerRequirements: [
      "accurate_identity",
      "business_contact_email",
      "innovateats_website",
      "easy_opt_out",
      "formal_unsubscribe"
    ],
    rules: [
      ...universalRules,
      "All email remains draft-only under LSSI review.",
      "Named-person data requires a documented lawful-basis assessment."
    ],
    sources: [
      {
        authority: "Boletin Oficial del Estado, LSSI articles 20-22",
        url: "https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758",
        checkedAt
      },
      {
        authority: "European Data Protection Board",
        url: "https://www.edpb.europa.eu/system/files/2024-10/edpb_summary_202401_legitimateinterest_en.pdf",
        checkedAt
      }
    ]
  }),
  fixture({
    code: "CENTRAL_EU",
    name: "Central Europe",
    version: "CENTRAL-EU-2026-07-19.1",
    defaultLanguage: "en",
    supportedLanguages: ["en", "es"],
    policyMode: "draft_only",
    channelModes: { email: "draft_only", ...manualChannelModes },
    footerRequirements: [
      "accurate_identity",
      "business_contact_email",
      "innovateats_website",
      "easy_opt_out",
      "formal_unsubscribe"
    ],
    rules: [
      ...universalRules,
      "Resolve a country-specific adapter before any external send.",
      "Use English unless Mateo has high or native proficiency in the requested local language."
    ],
    sources: [
      {
        authority: "European Data Protection Board",
        url: "https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_ga",
        checkedAt
      }
    ]
  }),
  fixture({
    code: "AU_NZ",
    name: "Australia and New Zealand",
    version: "AU-NZ-2026-07-19.1",
    defaultLanguage: "en",
    supportedLanguages: ["en"],
    policyMode: "draft_only",
    channelModes: { email: "draft_only", ...manualChannelModes },
    footerRequirements: [
      "accurate_identity",
      "business_contact_email",
      "innovateats_website",
      "easy_opt_out",
      "formal_unsubscribe"
    ],
    rules: [
      ...universalRules,
      "Record express, inferred or prior-relationship consent and the specific country.",
      "Never use harvested address lists."
    ],
    sources: [
      {
        authority: "Australian Communications and Media Authority",
        url: "https://www.acma.gov.au/avoid-sending-spam",
        checkedAt
      },
      {
        authority: "New Zealand Department of Internal Affairs",
        url: "https://www.dia.govt.nz/Spam-NZ-Spam-Law",
        checkedAt
      }
    ]
  }),
  fixture({
    code: "ASIA",
    name: "Asia (country adapter required)",
    version: "ASIA-2026-07-19.1",
    defaultLanguage: "en",
    supportedLanguages: ["en"],
    policyMode: "draft_only",
    channelModes: { email: "draft_only", ...manualChannelModes },
    footerRequirements: [
      "accurate_identity",
      "business_contact_email",
      "innovateats_website",
      "easy_opt_out",
      "formal_unsubscribe"
    ],
    rules: [
      ...universalRules,
      "Resolve and approve a country-specific adapter; no regional assumption authorizes sending.",
      "Only public corporate context may be drafted automatically."
    ],
    sources: [
      {
        authority: "Singapore Personal Data Protection Commission",
        url: "https://www.pdpc.gov.sg/complaints-and-reviews/before-you-lodge-a-complaint-with-us-3/spam",
        checkedAt
      }
    ]
  })
] as const satisfies readonly RegionPolicy[];

export function regionalPolicyByCode(code: string | null): RegionPolicy | null {
  if (code === null) {
    return null;
  }
  return regionalPolicyFixtures.find((policy) => policy.code === code.toUpperCase()) ?? null;
}
