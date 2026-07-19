import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import {
  complianceDecisionResultSchema,
  evaluateRegionalPolicy,
  INNOVATEATS_WEBSITE,
  regionPolicySchema,
  resolveRegionalLanguage,
  type ComplianceDecisionResult,
  type ComplianceInput,
  type ConsentStatus,
  type LanguageProficiency,
  type OutreachChannel,
  type RegionPolicy,
  type SubscriberType
} from "@innovateats/shared";

import type { AppDatabase } from "../client.js";
import {
  auditLog,
  campaigns,
  complianceDecisions,
  contacts,
  inboundMessages,
  leads,
  organizations,
  outboundMessages,
  regionPolicyVersions,
  regions,
  sequences,
  socialManualQueue,
  suppressionList
} from "../schema/index.js";

export class ComplianceStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ComplianceStateError";
  }
}

export interface CreateComplianceDecisionInput {
  readonly leadId: string;
  readonly contactId: string;
  readonly campaignId: string;
  readonly channel: OutreachChannel;
  readonly requestedLanguage: "en" | "es";
  readonly businessPostalAddressConfigured: boolean;
  readonly actorId: string;
}

export interface CreatedComplianceDecision {
  readonly id: string;
  readonly result: ComplianceDecisionResult;
  readonly regionEnabled: boolean;
  readonly regionName: string;
}

export interface RegionPolicyView {
  readonly regionId: string;
  readonly code: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly defaultLanguage: string;
  readonly timezoneStrategy: string;
  readonly policyMode: string;
  readonly policyId: string | null;
  readonly version: string | null;
  readonly policy: RegionPolicy | null;
}

export interface SocialManualItem {
  readonly id: string;
  readonly leadId: string;
  readonly contactId: string;
  readonly channel: Exclude<OutreachChannel, "email">;
  readonly directUrl: string;
  readonly message: string;
  readonly status: "draft" | "copied" | "marked_sent" | "cancelled";
  readonly reminderAt: Date | null;
  readonly copiedAt: Date | null;
  readonly markedSentAt: Date | null;
  readonly createdAt: Date;
}

function policyOrigin(
  origin: string
): "public_exact" | "provider_exact" | "manual" | "inferred_pattern" | "unknown" {
  if (origin === "published_public") {
    return "public_exact";
  }
  if (origin === "verification_provider") {
    return "provider_exact";
  }
  if (origin === "manual") {
    return "manual";
  }
  return origin === "inferred_pattern" ? "inferred_pattern" : "unknown";
}

function contactSupportsChannel(contactChannel: string, channel: OutreachChannel): boolean {
  if (channel === "email") {
    return contactChannel === "corporate_email" || contactChannel === "named_business_email";
  }
  if (channel === "linkedin" || channel === "instagram") {
    return contactChannel === channel;
  }
  return contactChannel === "platform_application";
}

function directUrlSupportsPlatform(url: string, channel: OutreachChannel): boolean {
  if (channel === "email") {
    return true;
  }
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === `${channel}.com` || hostname.endsWith(`.${channel}.com`);
  } catch {
    return false;
  }
}

function socialDraft(
  channel: Exclude<OutreachChannel, "email">,
  brandName: string,
  productSummary: string | null
): string {
  const context =
    productSummary === null
      ? `${brandName}'s public company profile`
      : `${brandName}'s public work on ${productSummary.slice(0, 140)}`;
  if (channel === "upwork") {
    return `Hi — I found this brief through its public Upwork job URL and reviewed ${context}. I’m Mateo Sanchez from InnovatEats. I can share a concrete product and ecommerce execution angle if useful. ${INNOVATEATS_WEBSITE}`;
  }
  if (channel === "kickstarter" || channel === "indiegogo") {
    return `Hi — I found ${brandName} through its public ${channel} campaign and reviewed ${context}. I’m Mateo Sanchez from InnovatEats. I have one specific product-to-market observation I can share if useful. ${INNOVATEATS_WEBSITE}`;
  }
  return `Hi — I found ${context}. I’m Mateo Sanchez from InnovatEats. I have one specific product and growth observation I can share if it is useful. ${INNOVATEATS_WEBSITE}`;
}

function toSocialItem(row: typeof socialManualQueue.$inferSelect): SocialManualItem {
  return {
    id: row.id,
    leadId: row.leadId,
    contactId: row.contactId,
    channel: row.channel,
    directUrl: row.directUrl,
    message: row.message,
    status: row.status,
    reminderAt: row.reminderAt,
    copiedAt: row.copiedAt,
    markedSentAt: row.markedSentAt,
    createdAt: row.createdAt
  };
}

export class PostgresComplianceRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async listRegionPolicies(): Promise<readonly RegionPolicyView[]> {
    const rows = await this.database
      .select({
        regionId: regions.id,
        code: regions.code,
        name: regions.name,
        enabled: regions.enabled,
        defaultLanguage: regions.defaultLanguage,
        timezoneStrategy: regions.timezoneStrategy,
        policyMode: regions.policyMode,
        policyId: regionPolicyVersions.id,
        version: regionPolicyVersions.version,
        policy: regionPolicyVersions.policy
      })
      .from(regions)
      .leftJoin(
        regionPolicyVersions,
        and(
          eq(regionPolicyVersions.regionId, regions.id),
          eq(regionPolicyVersions.status, "active")
        )
      )
      .orderBy(regions.code);
    return rows.map((row) => ({
      ...row,
      policy: row.policy === null ? null : regionPolicySchema.parse(row.policy)
    }));
  }

  public async setRegionEnabled(
    code: string,
    enabled: boolean,
    actorId: string
  ): Promise<RegionPolicyView> {
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(regions)
        .where(eq(regions.code, code.toUpperCase()))
        .limit(1)
        .for("update");
      if (current === undefined) {
        throw new ComplianceStateError("Region was not found.");
      }
      const [activePolicy] = await transaction
        .select()
        .from(regionPolicyVersions)
        .where(
          and(
            eq(regionPolicyVersions.regionId, current.id),
            eq(regionPolicyVersions.status, "active")
          )
        )
        .limit(1);
      if (enabled && activePolicy === undefined) {
        throw new ComplianceStateError("A region cannot be enabled without an active policy.");
      }
      await transaction
        .update(regions)
        .set({ enabled, updatedAt: new Date() })
        .where(eq(regions.id, current.id));
      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: enabled ? "compliance.region_enabled" : "compliance.region_disabled",
        entityType: "region",
        entityId: current.id,
        before: { enabled: current.enabled },
        after: { enabled, policyVersion: activePolicy?.version ?? null }
      });
      return {
        regionId: current.id,
        code: current.code,
        name: current.name,
        enabled,
        defaultLanguage: current.defaultLanguage,
        timezoneStrategy: current.timezoneStrategy,
        policyMode: current.policyMode,
        policyId: activePolicy?.id ?? null,
        version: activePolicy?.version ?? null,
        policy: activePolicy === undefined ? null : regionPolicySchema.parse(activePolicy.policy)
      };
    });
  }

  public async updateContactProfile(
    leadId: string,
    contactId: string,
    profile: {
      readonly subscriberType: SubscriberType;
      readonly consentStatus: ConsentStatus;
      readonly languageProficiency: LanguageProficiency;
      readonly evidence: Readonly<Record<string, unknown>>;
    },
    actorId: string
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [contact] = await transaction
        .select({ id: contacts.id, organizationId: contacts.organizationId })
        .from(contacts)
        .innerJoin(
          leads,
          and(eq(leads.id, leadId), eq(leads.organizationId, contacts.organizationId))
        )
        .where(eq(contacts.id, contactId))
        .limit(1);
      if (contact === undefined) {
        throw new ComplianceStateError("Contact does not belong to this lead.");
      }
      const now = new Date();
      await transaction
        .update(contacts)
        .set({
          subscriberType: profile.subscriberType,
          consentStatus: profile.consentStatus,
          languageProficiency: profile.languageProficiency,
          complianceEvidence: profile.evidence,
          complianceReviewedBy: actorId,
          complianceReviewedAt: now,
          updatedAt: now
        })
        .where(eq(contacts.id, contactId));
      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: "compliance.contact_profile_reviewed",
        entityType: "contact",
        entityId: contactId,
        after: profile
      });
    });
  }

  public async resolveMessageLanguage(
    leadId: string,
    contactId: string,
    requestedLanguage: "en" | "es"
  ): Promise<{
    readonly requestedLanguage: "en" | "es";
    readonly effectiveLanguage: "en" | "es";
    readonly proficiency: LanguageProficiency;
    readonly policyVersion: string;
  }> {
    const [row] = await this.database
      .select({
        proficiency: contacts.languageProficiency,
        version: regionPolicyVersions.version,
        policy: regionPolicyVersions.policy
      })
      .from(leads)
      .innerJoin(organizations, eq(organizations.id, leads.organizationId))
      .innerJoin(contacts, eq(contacts.organizationId, organizations.id))
      .innerJoin(regions, eq(regions.id, organizations.regionId))
      .innerJoin(
        regionPolicyVersions,
        and(
          eq(regionPolicyVersions.regionId, regions.id),
          eq(regionPolicyVersions.status, "active")
        )
      )
      .where(and(eq(leads.id, leadId), eq(contacts.id, contactId)))
      .limit(1);
    if (row === undefined) {
      throw new ComplianceStateError(
        "An active regional policy is required before localized message generation."
      );
    }
    return {
      requestedLanguage,
      effectiveLanguage: resolveRegionalLanguage(
        regionPolicySchema.parse(row.policy),
        requestedLanguage,
        row.proficiency
      ),
      proficiency: row.proficiency,
      policyVersion: row.version
    };
  }

  public async createDecision(
    input: CreateComplianceDecisionInput
  ): Promise<CreatedComplianceDecision> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          contact: contacts,
          regionId: regions.id,
          regionCode: regions.code,
          regionName: regions.name,
          regionEnabled: regions.enabled,
          policyId: regionPolicyVersions.id,
          policyVersion: regionPolicyVersions.version,
          policy: regionPolicyVersions.policy
        })
        .from(leads)
        .innerJoin(organizations, eq(organizations.id, leads.organizationId))
        .innerJoin(contacts, eq(contacts.organizationId, organizations.id))
        .innerJoin(campaigns, eq(campaigns.id, input.campaignId))
        .leftJoin(regions, eq(regions.id, organizations.regionId))
        .leftJoin(
          regionPolicyVersions,
          and(
            eq(regionPolicyVersions.regionId, regions.id),
            eq(regionPolicyVersions.status, "active")
          )
        )
        .where(and(eq(leads.id, input.leadId), eq(contacts.id, input.contactId)))
        .limit(1);
      if (
        row === undefined ||
        row.regionId === null ||
        row.regionCode === null ||
        row.regionName === null ||
        row.regionEnabled === null ||
        row.policyId === null ||
        row.policyVersion === null ||
        row.policy === null
      ) {
        throw new ComplianceStateError(
          "Lead requires an assigned region with an active policy before outreach."
        );
      }
      if (!contactSupportsChannel(row.contact.channelType, input.channel)) {
        throw new ComplianceStateError("The selected contact does not support this channel.");
      }
      if (!directUrlSupportsPlatform(row.contact.directUrl, input.channel)) {
        throw new ComplianceStateError("The direct platform URL does not match the channel.");
      }

      const [suppressed] = await transaction
        .select({ id: suppressionList.id })
        .from(suppressionList)
        .where(
          and(
            eq(suppressionList.normalizedContact, row.contact.normalizedValue),
            eq(suppressionList.channel, "email")
          )
        )
        .limit(1);
      const [activity] = await transaction
        .select({
          sent: sql<number>`count(DISTINCT ${outboundMessages.id}) FILTER (
            WHERE ${outboundMessages.deliveryStatus} = 'sent'
          )::int`,
          replies: sql<number>`count(DISTINCT ${inboundMessages.id})::int`
        })
        .from(sequences)
        .leftJoin(outboundMessages, eq(outboundMessages.sequenceId, sequences.id))
        .leftJoin(inboundMessages, eq(inboundMessages.sequenceId, sequences.id))
        .where(and(eq(sequences.leadId, input.leadId), eq(sequences.contactId, input.contactId)));
      const policy = regionPolicySchema.parse(row.policy);
      const policyInput: ComplianceInput = {
        regionCode: row.regionCode,
        regionEnabled: row.regionEnabled,
        channel: input.channel,
        subscriberType: row.contact.subscriberType,
        consentStatus: row.contact.consentStatus,
        isPersonalData: row.contact.isPersonalData,
        doNotContact: row.contact.doNotContact,
        suppressed: suppressed !== undefined,
        contactOrigin: policyOrigin(row.contact.origin),
        requestedLanguage: input.requestedLanguage,
        languageProficiency: row.contact.languageProficiency,
        businessPostalAddressConfigured: input.businessPostalAddressConfigured,
        touchesAlreadySent: Number(activity?.sent ?? 0),
        hasHumanReply: Number(activity?.replies ?? 0) > 0
      };
      const output = complianceDecisionResultSchema.parse(
        evaluateRegionalPolicy(policy, policyInput)
      );
      const decisionId = randomUUID();
      const inputHash = createHash("sha256").update(JSON.stringify(policyInput)).digest("hex");
      await transaction.insert(complianceDecisions).values({
        id: decisionId,
        leadId: input.leadId,
        contactId: input.contactId,
        campaignId: input.campaignId,
        regionPolicyId: row.policyId,
        regionPolicyVersion: row.policyVersion,
        channel: input.channel,
        decision: output.decision,
        reasons: output.reasons,
        legalBasisTag: output.legalBasisTag,
        inputHash,
        input: policyInput,
        output,
        createdBy: input.actorId
      });
      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId: input.actorId,
        action: "compliance.decision_recorded",
        entityType: "compliance_decision",
        entityId: decisionId,
        after: {
          leadId: input.leadId,
          contactId: input.contactId,
          campaignId: input.campaignId,
          channel: input.channel,
          decision: output.decision,
          policyVersion: output.policyVersion,
          legalBasisTag: output.legalBasisTag
        }
      });
      return {
        id: decisionId,
        result: output,
        regionEnabled: row.regionEnabled,
        regionName: row.regionName
      };
    });
  }

  public async listSocialItems(leadId: string): Promise<readonly SocialManualItem[]> {
    const rows = await this.database
      .select()
      .from(socialManualQueue)
      .where(eq(socialManualQueue.leadId, leadId))
      .orderBy(desc(socialManualQueue.createdAt));
    return rows.map(toSocialItem);
  }

  public async createSocialItem(
    input: Omit<CreateComplianceDecisionInput, "channel"> & {
      readonly channel: Exclude<OutreachChannel, "email">;
      readonly reminderAt?: Date;
    }
  ): Promise<SocialManualItem> {
    const decision = await this.createDecision(input);
    if (decision.result.decision !== "draft_only") {
      throw new ComplianceStateError(
        `Manual platform draft refused by policy decision ${decision.result.decision}.`
      );
    }
    return this.database.transaction(async (transaction) => {
      const [context] = await transaction
        .select({
          contact: contacts,
          brandName: organizations.displayName,
          productSummary: organizations.productSummary
        })
        .from(leads)
        .innerJoin(organizations, eq(organizations.id, leads.organizationId))
        .innerJoin(contacts, eq(contacts.organizationId, organizations.id))
        .where(and(eq(leads.id, input.leadId), eq(contacts.id, input.contactId)))
        .limit(1);
      if (context === undefined) {
        throw new ComplianceStateError("Contact does not belong to this lead.");
      }
      const [created] = await transaction
        .insert(socialManualQueue)
        .values({
          leadId: input.leadId,
          contactId: input.contactId,
          complianceDecisionId: decision.id,
          channel: input.channel,
          directUrl: context.contact.directUrl,
          message: socialDraft(input.channel, context.brandName, context.productSummary),
          reminderAt: input.reminderAt,
          createdBy: input.actorId,
          automaticActionAttempted: false
        })
        .returning();
      if (created === undefined) {
        throw new ComplianceStateError("Manual platform item was not created.");
      }
      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId: input.actorId,
        action: "social_manual.draft_created",
        entityType: "social_manual_queue",
        entityId: created.id,
        after: { channel: input.channel, externalAction: false }
      });
      return toSocialItem(created);
    });
  }

  public async transitionSocialItem(
    leadId: string,
    itemId: string,
    action: "copied" | "marked_sent" | "cancelled",
    actorId: string
  ): Promise<SocialManualItem> {
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(socialManualQueue)
        .where(and(eq(socialManualQueue.id, itemId), eq(socialManualQueue.leadId, leadId)))
        .limit(1)
        .for("update");
      if (current === undefined) {
        throw new ComplianceStateError("Manual platform item was not found.");
      }
      const now = new Date();
      const allowed =
        (current.status === "draft" && (action === "copied" || action === "cancelled")) ||
        (current.status === "copied" && (action === "marked_sent" || action === "cancelled"));
      if (!allowed) {
        throw new ComplianceStateError(`Cannot move ${current.status} to ${action}.`);
      }
      const [updated] = await transaction
        .update(socialManualQueue)
        .set({
          status: action,
          ...(action === "copied" ? { copiedAt: now } : {}),
          ...(action === "marked_sent" ? { markedSentAt: now } : {}),
          updatedAt: now
        })
        .where(eq(socialManualQueue.id, itemId))
        .returning();
      if (updated === undefined) {
        throw new ComplianceStateError("Manual platform transition was not stored.");
      }
      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: `social_manual.${action}`,
        entityType: "social_manual_queue",
        entityId: itemId,
        after: { status: action, externalActionAutomated: false }
      });
      return toSocialItem(updated);
    });
  }
}
