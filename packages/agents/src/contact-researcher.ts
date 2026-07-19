import { z } from "zod";

import {
  contactResearchOutputSchema,
  normalizeContactValue,
  normalizePublicUrl,
  sourceSnapshotSchema,
  type ContactCandidate,
  type ContactChannelType,
  type ContactResearchOutput,
  type SourceSnapshot
} from "@innovateats/shared";

export interface ContactResearchContext {
  readonly organizationDomain: string;
  readonly sourceDocumentId: string;
  readonly evidenceId: string;
  readonly country?: string;
  readonly snapshot: SourceSnapshot;
}

const genericEmailLocalParts = new Set([
  "business",
  "collab",
  "collaborations",
  "commercial",
  "contact",
  "hello",
  "hi",
  "info",
  "partnerships",
  "press",
  "sales",
  "support",
  "team"
]);

function emailChannel(address: string): ContactChannelType {
  const localPart = address.split("@")[0]?.toLowerCase() ?? "";
  return genericEmailLocalParts.has(localPart) ? "corporate_email" : "named_business_email";
}

function linkedChannel(url: string): ContactChannelType | null {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase().replace(/^www\./u, "");
  const path = parsed.pathname.toLowerCase();
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    return "linkedin";
  }
  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    return "instagram";
  }
  if (
    host === "kickstarter.com" ||
    host.endsWith(".kickstarter.com") ||
    host === "indiegogo.com" ||
    host.endsWith(".indiegogo.com") ||
    /(?:^|\/)(?:apply|application|campaign)(?:\/|$)/u.test(path)
  ) {
    return "platform_application";
  }
  return null;
}

function isContactFormLink(url: string, label: string): boolean {
  const parsed = new URL(url);
  return (
    /(?:^|\/)(?:contact|contact-us|get-in-touch)(?:\/|$)/iu.test(parsed.pathname) ||
    /\b(?:contact|enquir|inquir|get in touch)\b/iu.test(label)
  );
}

export function extractPublicContacts(context: ContactResearchContext): ContactResearchOutput {
  const snapshot = sourceSnapshotSchema.parse(context.snapshot);
  const sourceDocumentId = z.uuid().parse(context.sourceDocumentId);
  const evidenceId = z.uuid().parse(context.evidenceId);
  const organizationDomain = normalizePublicUrl(`https://${context.organizationDomain}`).domain;
  const sourceDomain = normalizePublicUrl(snapshot.finalUrl).domain;

  if (sourceDomain !== organizationDomain) {
    return contactResearchOutputSchema.parse({
      contacts: [],
      warnings: [
        `Source domain ${sourceDomain} is not the canonical organization domain ${organizationDomain}; association requires manual review.`
      ]
    });
  }

  const contacts: ContactCandidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: ContactCandidate) => {
    const parsed = contactResearchOutputSchema.shape.contacts.element.parse(candidate);
    const key = `${parsed.channelType}:${normalizeContactValue(parsed.channelType, parsed.value)}`;
    if (!seen.has(key)) {
      seen.add(key);
      contacts.push(parsed);
    }
  };
  const common = {
    founderId: null,
    fullName: null,
    role: null,
    sourceUrl: snapshot.finalUrl,
    sourceDocumentId,
    evidenceId,
    origin: "published_public" as const,
    verificationProvider: null,
    country: context.country ?? null
  };

  for (const link of snapshot.publicLinks) {
    if (link.kind === "mailto") {
      const address = link.href.slice("mailto:".length).trim().toLowerCase();
      if (!z.email().safeParse(address).success) {
        continue;
      }
      add({
        ...common,
        channelType: emailChannel(address),
        value: address,
        directUrl: `mailto:${address}`,
        provenance: "Published mailto link on the canonical organization website.",
        verificationStatus: "published_verified",
        isPersonalData: emailChannel(address) === "named_business_email",
        confidence: 0.99
      });
      continue;
    }

    if (link.kind === "form" || isContactFormLink(link.href, link.label)) {
      add({
        ...common,
        channelType: "contact_form",
        value: link.href,
        directUrl: link.href,
        provenance: "Direct contact form linked from the canonical organization website.",
        verificationStatus: "published_verified",
        isPersonalData: false,
        confidence: 0.97
      });
      continue;
    }

    const channel = linkedChannel(link.href);
    if (channel !== null) {
      add({
        ...common,
        channelType: channel,
        value: link.href,
        directUrl: link.href,
        provenance: "Public profile or platform route linked from the canonical website.",
        verificationStatus: "published_verified",
        isPersonalData: channel === "linkedin" || channel === "instagram",
        confidence: 0.92
      });
    }
  }

  const visibleEmails =
    snapshot.extractedText.match(
      /(?<![a-z0-9._%+-])[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63}(?![a-z0-9.-])/giu
    ) ?? [];
  for (const rawAddress of visibleEmails) {
    const address = rawAddress.toLowerCase();
    const channel = emailChannel(address);
    add({
      ...common,
      channelType: channel,
      value: address,
      directUrl: `mailto:${address}`,
      provenance:
        "Address appears in canonical-site text but lacks an explicit mailto link; business context requires review.",
      verificationStatus: "manual_review",
      isPersonalData: channel === "named_business_email",
      confidence: 0.7
    });
  }

  return contactResearchOutputSchema.parse({
    contacts,
    warnings:
      contacts.length === 0
        ? ["No public contact path was found in the supplied official snapshot."]
        : []
  });
}
