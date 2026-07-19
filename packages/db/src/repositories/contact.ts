import { and, desc, eq, inArray } from "drizzle-orm";

import {
  contactCandidateSchema,
  contactIsActionable,
  contactOriginSchema,
  contactVerificationStatusSchema,
  emailVerificationResultSchema,
  leadStatusSchema,
  normalizeContactValue,
  sourceSnapshotSchema,
  type ContactCandidate,
  type ContactChannelType,
  type ContactOrigin,
  type ContactVerificationStatus,
  type EmailVerificationResult,
  type LeadStatus,
  type SourceSnapshot
} from "@innovateats/shared";

import type { AppDatabase } from "../client.js";
import {
  auditLog,
  contacts,
  contactVerifications,
  evidence,
  founders,
  leads,
  leadStatusHistory,
  organizations,
  sourceDocuments
} from "../schema/index.js";
import { LeadNotFoundError } from "./crm.js";

export interface ContactRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly founderId: string | null;
  readonly fullName: string | null;
  readonly role: string | null;
  readonly channelType: ContactChannelType;
  readonly value: string;
  readonly normalizedValue: string;
  readonly directUrl: string;
  readonly sourceUrl: string;
  readonly sourceDocumentId: string;
  readonly evidenceId: string;
  readonly origin: ContactOrigin;
  readonly provenance: string;
  readonly verificationStatus: ContactVerificationStatus;
  readonly verificationProvider: string | null;
  readonly isPersonalData: boolean;
  readonly country: string | null;
  readonly confidence: number;
  readonly doNotContact: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ContactExtractionSource {
  readonly organizationDomain: string;
  readonly country: string;
  readonly sourceDocumentId: string;
  readonly evidenceId: string;
  readonly snapshot: SourceSnapshot;
}

export interface SaveContactResult {
  readonly contacts: readonly ContactRecord[];
  readonly createdCount: number;
  readonly actionableCount: number;
  readonly leadStatus: LeadStatus;
}

export class ContactNotFoundError extends Error {
  public constructor() {
    super("Contact not found.");
    this.name = "ContactNotFoundError";
  }
}

export class ContactAssociationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ContactAssociationError";
  }
}

function toRecord(row: typeof contacts.$inferSelect): ContactRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    founderId: row.founderId,
    fullName: row.fullName,
    role: row.role,
    channelType: row.channelType,
    value: row.value,
    normalizedValue: row.normalizedValue,
    directUrl: row.directUrl,
    sourceUrl: row.sourceUrl,
    sourceDocumentId: row.sourceDocumentId,
    evidenceId: row.evidenceId,
    origin: contactOriginSchema.parse(row.origin),
    provenance: row.provenance,
    verificationStatus: contactVerificationStatusSchema.parse(row.verificationStatus),
    verificationProvider: row.verificationProvider,
    isPersonalData: row.isPersonalData,
    country: row.country,
    confidence: row.confidence,
    doNotContact: row.doNotContact,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export class PostgresContactRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async getExtractionSource(
    leadId: string,
    evidenceId: string
  ): Promise<ContactExtractionSource> {
    const [row] = await this.database
      .select({
        organizationDomain: organizations.canonicalDomain,
        country: organizations.country,
        evidenceId: evidence.id,
        sourceDocumentId: sourceDocuments.id,
        requestedUrl: sourceDocuments.url,
        finalUrl: sourceDocuments.canonicalUrl,
        title: sourceDocuments.title,
        extractedText: sourceDocuments.extractedText,
        contentHash: sourceDocuments.contentHash,
        fetchedAt: sourceDocuments.fetchedAt,
        metadata: sourceDocuments.metadata
      })
      .from(leads)
      .innerJoin(organizations, eq(leads.organizationId, organizations.id))
      .innerJoin(
        evidence,
        and(
          eq(evidence.leadId, leads.id),
          eq(evidence.id, evidenceId),
          eq(evidence.state, "active")
        )
      )
      .innerJoin(sourceDocuments, eq(evidence.sourceDocumentId, sourceDocuments.id))
      .where(eq(leads.id, leadId))
      .limit(1);
    if (row === undefined) {
      throw new ContactAssociationError(
        "Active evidence with a source snapshot was not found on this lead."
      );
    }
    if (row.contentHash === null || row.fetchedAt === null) {
      throw new ContactAssociationError("Contact extraction requires a secure source snapshot.");
    }

    const metadata = row.metadata;
    const snapshot = sourceSnapshotSchema.parse({
      requestedUrl: metadata.requestedUrl ?? row.requestedUrl,
      finalUrl: row.finalUrl,
      title: row.title,
      extractedText: row.extractedText ?? "",
      contentHash: row.contentHash,
      contentType: metadata.contentType,
      fetchedAt: row.fetchedAt.toISOString(),
      byteLength: metadata.byteLength,
      redirectCount: metadata.redirectCount,
      resolvedAddresses: metadata.resolvedAddresses,
      robotsDecision: metadata.robotsDecision,
      publicLinks: metadata.publicLinks ?? []
    });

    return {
      organizationDomain: row.organizationDomain,
      country: row.country,
      sourceDocumentId: row.sourceDocumentId,
      evidenceId: row.evidenceId,
      snapshot
    };
  }

  public async saveCandidates(
    leadId: string,
    rawCandidates: readonly ContactCandidate[],
    actorId: string
  ): Promise<SaveContactResult> {
    if (rawCandidates.length > 100) {
      throw new ContactAssociationError("A contact batch cannot exceed 100 candidates.");
    }
    const candidates = rawCandidates.map((candidate) => contactCandidateSchema.parse(candidate));

    return this.database.transaction(async (transaction) => {
      const [lead] = await transaction
        .select()
        .from(leads)
        .where(eq(leads.id, leadId))
        .limit(1)
        .for("update");
      if (lead === undefined) {
        throw new LeadNotFoundError();
      }
      const currentStatus = leadStatusSchema.parse(lead.status);
      if (
        currentStatus !== "scored" &&
        currentStatus !== "contact_found" &&
        currentStatus !== "no_contact"
      ) {
        throw new ContactAssociationError(`Contact discovery is not valid from ${currentStatus}.`);
      }

      const evidenceIds = [...new Set(candidates.map((candidate) => candidate.evidenceId))];
      const evidenceRows =
        evidenceIds.length === 0
          ? []
          : await transaction
              .select({
                id: evidence.id,
                sourceDocumentId: evidence.sourceDocumentId
              })
              .from(evidence)
              .where(
                and(
                  eq(evidence.leadId, leadId),
                  eq(evidence.state, "active"),
                  inArray(evidence.id, evidenceIds)
                )
              );
      const evidenceMap = new Map(
        evidenceRows.map((row) => [row.id, row.sourceDocumentId] as const)
      );
      if (evidenceMap.size !== evidenceIds.length) {
        throw new ContactAssociationError(
          "Every contact must cite active evidence from the same lead."
        );
      }

      const founderIds = [
        ...new Set(
          candidates.flatMap((candidate) =>
            candidate.founderId === null ? [] : [candidate.founderId]
          )
        )
      ];
      const founderRows =
        founderIds.length === 0
          ? []
          : await transaction
              .select({ id: founders.id })
              .from(founders)
              .where(
                and(
                  eq(founders.organizationId, lead.organizationId),
                  inArray(founders.id, founderIds)
                )
              );
      if (founderRows.length !== founderIds.length) {
        throw new ContactAssociationError(
          "Every attached founder must belong to the contact organization."
        );
      }

      const records: ContactRecord[] = [];
      let createdCount = 0;
      for (const candidate of candidates) {
        if (evidenceMap.get(candidate.evidenceId) !== candidate.sourceDocumentId) {
          throw new ContactAssociationError(
            "Contact source document does not match its cited evidence."
          );
        }
        const normalizedValue = normalizeContactValue(candidate.channelType, candidate.value);
        const [created] = await transaction
          .insert(contacts)
          .values({
            organizationId: lead.organizationId,
            founderId: candidate.founderId,
            sourceDocumentId: candidate.sourceDocumentId,
            evidenceId: candidate.evidenceId,
            fullName: candidate.fullName,
            role: candidate.role,
            channelType: candidate.channelType,
            value: candidate.value,
            normalizedValue,
            directUrl: candidate.directUrl,
            sourceUrl: candidate.sourceUrl,
            origin: candidate.origin,
            provenance: candidate.provenance,
            verificationStatus: candidate.verificationStatus,
            verificationProvider: candidate.verificationProvider,
            isPersonalData: candidate.isPersonalData,
            country: candidate.country,
            confidence: candidate.confidence
          })
          .onConflictDoNothing()
          .returning();
        const row =
          created ??
          (
            await transaction
              .select()
              .from(contacts)
              .where(
                and(
                  eq(contacts.organizationId, lead.organizationId),
                  eq(contacts.channelType, candidate.channelType),
                  eq(contacts.normalizedValue, normalizedValue)
                )
              )
              .limit(1)
          )[0];
        if (row === undefined) {
          throw new Error("Contact could not be resolved.");
        }
        if (created !== undefined) {
          createdCount += 1;
        }
        records.push(toRecord(row));
      }

      const actionableCount = records.filter(
        (record) =>
          !record.doNotContact && contactIsActionable(record.origin, record.verificationStatus)
      ).length;
      const nextStatus =
        actionableCount > 0 && currentStatus !== "contact_found" ? "contact_found" : currentStatus;
      if (currentStatus !== nextStatus) {
        await transaction
          .update(leads)
          .set({ status: nextStatus, updatedAt: new Date() })
          .where(eq(leads.id, leadId));
        await transaction.insert(leadStatusHistory).values({
          leadId,
          fromStatus: currentStatus,
          toStatus: nextStatus,
          reason: "Actionable public contact path captured",
          actorId
        });
      }
      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: "contacts.extracted",
        entityType: "lead",
        entityId: leadId,
        before: { status: currentStatus },
        after: {
          status: nextStatus,
          candidateCount: candidates.length,
          createdCount,
          actionableCount,
          contactIds: records.map((record) => record.id)
        }
      });

      return { contacts: records, createdCount, actionableCount, leadStatus: nextStatus };
    });
  }

  public async listForLead(leadId: string): Promise<readonly ContactRecord[]> {
    const rows = await this.database
      .select({ contact: contacts })
      .from(leads)
      .innerJoin(contacts, eq(contacts.organizationId, leads.organizationId))
      .where(eq(leads.id, leadId))
      .orderBy(desc(contacts.confidence), contacts.channelType, contacts.normalizedValue);
    return rows.map((row) => toRecord(row.contact));
  }

  public async getForVerification(leadId: string, contactId: string): Promise<ContactRecord> {
    const [row] = await this.database
      .select({ contact: contacts })
      .from(leads)
      .innerJoin(contacts, eq(contacts.organizationId, leads.organizationId))
      .where(and(eq(leads.id, leadId), eq(contacts.id, contactId)))
      .limit(1);
    if (row === undefined) {
      throw new ContactNotFoundError();
    }
    const record = toRecord(row.contact);
    if (record.channelType !== "corporate_email" && record.channelType !== "named_business_email") {
      throw new ContactAssociationError("Only email contacts use mailbox verification.");
    }
    return record;
  }

  public async recordVerification(
    leadId: string,
    contactId: string,
    rawResult: EmailVerificationResult,
    actorId: string
  ): Promise<ContactRecord> {
    const result = emailVerificationResultSchema.parse(rawResult);

    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({ contact: contacts })
        .from(leads)
        .innerJoin(contacts, eq(contacts.organizationId, leads.organizationId))
        .where(and(eq(leads.id, leadId), eq(contacts.id, contactId)))
        .limit(1)
        .for("update", { of: contacts });
      if (row === undefined) {
        throw new ContactNotFoundError();
      }
      const contact = toRecord(row.contact);
      if (
        contact.channelType !== "corporate_email" &&
        contact.channelType !== "named_business_email"
      ) {
        throw new ContactAssociationError("Only email contacts use mailbox verification.");
      }
      if (result.normalizedEmail !== contact.normalizedValue) {
        throw new ContactAssociationError("Verification result does not belong to this contact.");
      }

      const preservesExistingVerification =
        result.status === "syntax_valid" ||
        result.status === "mx_valid" ||
        result.status === "manual_review";
      const appliedStatus: ContactVerificationStatus =
        contact.origin === "inferred_pattern" && result.status === "provider_verified"
          ? "manual_review"
          : (contact.verificationStatus === "published_verified" ||
                contact.verificationStatus === "provider_verified") &&
              preservesExistingVerification
            ? contact.verificationStatus
            : result.status;
      const appliedProvider =
        appliedStatus === "published_verified" ? contact.verificationProvider : result.provider;

      await transaction.insert(contactVerifications).values({
        contactId,
        status: appliedStatus,
        provider: appliedProvider,
        syntaxValid: result.syntaxValid,
        mxFound: result.mxFound,
        providerVerdict: result.providerVerdict,
        reason: result.reason,
        checkedAt: new Date(result.checkedAt),
        result,
        createdBy: actorId
      });
      const [updated] = await transaction
        .update(contacts)
        .set({
          verificationStatus: appliedStatus,
          verificationProvider: appliedProvider,
          updatedAt: new Date()
        })
        .where(eq(contacts.id, contactId))
        .returning();
      if (updated === undefined) {
        throw new Error("Contact verification update returned no record.");
      }
      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: "contact.verification_recorded",
        entityType: "contact",
        entityId: contactId,
        before: {
          status: contact.verificationStatus,
          provider: contact.verificationProvider
        },
        after: {
          status: appliedStatus,
          provider: appliedProvider,
          providerVerdict: result.providerVerdict
        }
      });
      return toRecord(updated);
    });
  }
}
