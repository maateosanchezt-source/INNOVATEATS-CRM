import { eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import {
  auditLog,
  complianceDecisions,
  contacts,
  evidence,
  founders,
  inboundMessages,
  leadScores,
  leads,
  messageApprovals,
  messageDrafts,
  organizations,
  outboundMessages,
  replyClassificationsTable,
  sequences,
  suppressionList
} from "../schema/index.js";

export interface DataExportBundle {
  readonly schemaVersion: "crm-owner-export-v1";
  readonly generatedAt: string;
  readonly owner: string;
  readonly collections: Readonly<Record<string, readonly unknown[]>>;
}

export interface ErasureResult {
  readonly leadId: string;
  readonly organizationId: string;
  readonly contactsAnonymized: number;
  readonly foundersAnonymized: number;
  readonly retainedForAudit: readonly ["evidence", "status_history", "audit_log"];
}

export class DataGovernanceStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DataGovernanceStateError";
  }
}

export class PostgresDataGovernanceRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async exportOwnedData(owner: string, now = new Date()): Promise<DataExportBundle> {
    const leadRows = await this.database.select().from(leads).where(eq(leads.currentOwner, owner));
    const leadIds = leadRows.map((lead) => lead.id);
    const organizationIds = leadRows.map((lead) => lead.organizationId);
    if (leadIds.length === 0) {
      return {
        schemaVersion: "crm-owner-export-v1",
        generatedAt: now.toISOString(),
        owner,
        collections: {
          leads: [],
          organizations: [],
          founders: [],
          contacts: [],
          evidence: [],
          scores: [],
          messages: [],
          approvals: [],
          sequences: [],
          outbounds: [],
          inbound: [],
          replyClassifications: [],
          complianceDecisions: [],
          suppression: []
        }
      };
    }

    const contactRows = await this.database
      .select()
      .from(contacts)
      .where(inArray(contacts.organizationId, organizationIds));
    const contactValues = contactRows.map((contact) => contact.normalizedValue);
    const [
      organizationRows,
      founderRows,
      evidenceRows,
      scoreRows,
      messageRows,
      approvalRows,
      sequenceRows,
      outboundRows,
      inboundRows,
      replyRows,
      complianceRows,
      suppressionRows
    ] = await Promise.all([
      this.database.select().from(organizations).where(inArray(organizations.id, organizationIds)),
      this.database
        .select()
        .from(founders)
        .where(inArray(founders.organizationId, organizationIds)),
      this.database.select().from(evidence).where(inArray(evidence.leadId, leadIds)),
      this.database.select().from(leadScores).where(inArray(leadScores.leadId, leadIds)),
      this.database.select().from(messageDrafts).where(inArray(messageDrafts.leadId, leadIds)),
      this.database
        .select({ approval: messageApprovals, draft: messageDrafts })
        .from(messageApprovals)
        .innerJoin(messageDrafts, eq(messageDrafts.id, messageApprovals.messageDraftId))
        .where(inArray(messageDrafts.leadId, leadIds)),
      this.database.select().from(sequences).where(inArray(sequences.leadId, leadIds)),
      this.database
        .select({ outbound: outboundMessages, sequence: sequences })
        .from(outboundMessages)
        .innerJoin(sequences, eq(sequences.id, outboundMessages.sequenceId))
        .where(inArray(sequences.leadId, leadIds)),
      this.database.select().from(inboundMessages).where(inArray(inboundMessages.leadId, leadIds)),
      this.database
        .select({ classification: replyClassificationsTable, inbound: inboundMessages })
        .from(replyClassificationsTable)
        .innerJoin(
          inboundMessages,
          eq(inboundMessages.id, replyClassificationsTable.inboundMessageId)
        )
        .where(inArray(inboundMessages.leadId, leadIds)),
      this.database
        .select()
        .from(complianceDecisions)
        .where(inArray(complianceDecisions.leadId, leadIds)),
      contactValues.length === 0
        ? Promise.resolve([])
        : this.database
            .select()
            .from(suppressionList)
            .where(inArray(suppressionList.normalizedContact, contactValues))
    ]);
    return {
      schemaVersion: "crm-owner-export-v1",
      generatedAt: now.toISOString(),
      owner,
      collections: {
        leads: leadRows,
        organizations: organizationRows,
        founders: founderRows,
        contacts: contactRows,
        evidence: evidenceRows,
        scores: scoreRows,
        messages: messageRows,
        approvals: approvalRows,
        sequences: sequenceRows,
        outbounds: outboundRows,
        inbound: inboundRows,
        replyClassifications: replyRows,
        complianceDecisions: complianceRows,
        suppression: suppressionRows
      }
    };
  }

  public async eraseRejectedUncontactedLead(
    leadId: string,
    actorId: string
  ): Promise<ErasureResult> {
    return this.database.transaction(async (transaction) => {
      const [lead] = await transaction
        .select({
          id: leads.id,
          organizationId: leads.organizationId,
          status: leads.status,
          currentOwner: leads.currentOwner
        })
        .from(leads)
        .where(eq(leads.id, leadId))
        .limit(1);
      if (lead === undefined || lead.currentOwner?.toLowerCase() !== actorId.toLowerCase()) {
        throw new DataGovernanceStateError("The lead is not owned by the authorized user.");
      }
      if (lead.status !== "rejected") {
        throw new DataGovernanceStateError("Only a rejected lead can enter privacy erasure.");
      }
      const [existingSequence] = await transaction
        .select({ id: sequences.id })
        .from(sequences)
        .where(eq(sequences.leadId, leadId))
        .limit(1);
      if (existingSequence !== undefined) {
        throw new DataGovernanceStateError(
          "Contacted or scheduled leads require a reviewed retention decision."
        );
      }

      const [contactRows, founderRows] = await Promise.all([
        transaction
          .select({ id: contacts.id })
          .from(contacts)
          .where(eq(contacts.organizationId, lead.organizationId)),
        transaction
          .select({ id: founders.id })
          .from(founders)
          .where(eq(founders.organizationId, lead.organizationId))
      ]);
      for (const contact of contactRows) {
        const erasedValue = `erased-${contact.id}@privacy.invalid`;
        await transaction
          .update(contacts)
          .set({
            fullName: null,
            role: null,
            value: erasedValue,
            normalizedValue: erasedValue,
            directUrl: "https://innovateats.com/privacy-erased",
            sourceUrl: "https://innovateats.com/privacy-erased",
            provenance: "privacy_erasure",
            verificationStatus: "invalid",
            verificationProvider: null,
            isPersonalData: false,
            complianceEvidence: {},
            complianceReviewedBy: null,
            complianceReviewedAt: null,
            country: null,
            confidence: 0,
            doNotContact: true,
            updatedAt: new Date()
          })
          .where(eq(contacts.id, contact.id));
      }
      for (const founder of founderRows) {
        await transaction
          .update(founders)
          .set({
            name: "Erased person",
            normalizedName: `erased-${founder.id}`,
            role: "erased",
            publicProfileUrls: [],
            confidence: 0,
            updatedAt: new Date()
          })
          .where(eq(founders.id, founder.id));
      }
      await transaction
        .update(organizations)
        .set({
          normalizedName: `erased-${lead.organizationId}`,
          displayName: "[erased]",
          canonicalDomain: `erased-${lead.organizationId}.privacy.invalid`,
          country: "Erased",
          regionId: null,
          stage: "erased",
          productSummary: null,
          updatedAt: new Date()
        })
        .where(eq(organizations.id, lead.organizationId));
      await transaction
        .update(leads)
        .set({
          discoverySignal: null,
          currentOwner: null,
          nextActionAt: null,
          updatedAt: new Date()
        })
        .where(eq(leads.id, leadId));
      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: "lead.privacy_erased",
        entityType: "lead",
        entityId: leadId,
        before: { status: lead.status, owner: actorId },
        after: {
          activePiiAnonymized: true,
          retainedForAudit: ["evidence", "status_history", "audit_log"]
        }
      });
      return {
        leadId,
        organizationId: lead.organizationId,
        contactsAnonymized: contactRows.length,
        foundersAnonymized: founderRows.length,
        retainedForAudit: ["evidence", "status_history", "audit_log"] as const
      };
    });
  }
}
