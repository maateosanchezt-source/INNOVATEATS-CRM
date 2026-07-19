import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

import {
  canTransitionLead,
  leadStatusSchema,
  normalizePublicUrl,
  type EvidenceInput,
  type LeadStatus,
  type LeadUpdateInput,
  type ManualLeadIngestInput
} from "@innovateats/shared";

import type { AppDatabase } from "../client.js";
import {
  auditLog,
  evidence,
  leads,
  leadStatusHistory,
  organizations,
  regions,
  sourceDocuments,
  sources
} from "../schema/index.js";

export interface LeadListFilters {
  readonly status?: LeadStatus;
  readonly search?: string;
  readonly limit?: number;
}

export interface LeadListItem {
  readonly id: string;
  readonly brandName: string;
  readonly productSummary: string | null;
  readonly country: string;
  readonly regionCode: string | null;
  readonly stage: string;
  readonly score: number;
  readonly status: LeadStatus;
  readonly discoverySignal: string | null;
  readonly evidenceCount: number;
  readonly nextActionAt: Date | null;
  readonly firstDiscoveredAt: Date;
}

export interface EvidenceRecord {
  readonly id: string;
  readonly factType: string;
  readonly claim: string;
  readonly quoteOrSummary: string;
  readonly sourceUrl: string;
  readonly observedAt: Date;
  readonly confidence: number;
  readonly isInference: boolean;
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export interface LeadHistoryRecord {
  readonly id: number;
  readonly fromStatus: LeadStatus | null;
  readonly toStatus: LeadStatus;
  readonly reason: string | null;
  readonly actorId: string;
  readonly createdAt: Date;
}

export interface LeadDetail extends LeadListItem {
  readonly canonicalDomain: string;
  readonly currentOwner: string | null;
  readonly scoreConfidence: number;
  readonly hardExclusion: boolean;
  readonly exclusionReason: string | null;
  readonly evidence: readonly EvidenceRecord[];
  readonly history: readonly LeadHistoryRecord[];
}

export interface ManualIngestResult {
  readonly leadId: string;
  readonly created: boolean;
}

export class LeadNotFoundError extends Error {
  public constructor() {
    super("Lead not found.");
    this.name = "LeadNotFoundError";
  }
}

export class EvidenceNotFoundError extends Error {
  public constructor() {
    super("Evidence not found.");
    this.name = "EvidenceNotFoundError";
  }
}

export class InvalidLeadTransitionError extends Error {
  public constructor(from: LeadStatus, to: LeadStatus) {
    super(`Lead cannot transition from ${from} to ${to}.`);
    this.name = "InvalidLeadTransitionError";
  }
}

function normalizeOrganizationName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

export class PostgresCrmRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async listLeads(filters: LeadListFilters = {}): Promise<readonly LeadListItem[]> {
    const conditions = [
      ...(filters.status === undefined ? [] : [eq(leads.status, filters.status)]),
      ...(filters.search === undefined || filters.search.trim() === ""
        ? []
        : [
            or(
              ilike(organizations.displayName, `%${filters.search.trim()}%`),
              ilike(organizations.productSummary, `%${filters.search.trim()}%`),
              ilike(organizations.canonicalDomain, `%${filters.search.trim()}%`)
            )
          ])
    ];

    const rows = await this.database
      .select({
        id: leads.id,
        brandName: organizations.displayName,
        productSummary: organizations.productSummary,
        country: organizations.country,
        regionCode: regions.code,
        stage: organizations.stage,
        score: leads.icpScore,
        status: leads.status,
        discoverySignal: leads.discoverySignal,
        nextActionAt: leads.nextActionAt,
        firstDiscoveredAt: leads.firstDiscoveredAt,
        evidenceCount: sql<number>`(
          SELECT count(*)::integer
          FROM evidence
          WHERE evidence.lead_id = ${leads.id}
            AND evidence.state = 'active'
        )`
      })
      .from(leads)
      .innerJoin(organizations, eq(leads.organizationId, organizations.id))
      .leftJoin(regions, eq(organizations.regionId, regions.id))
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(desc(leads.firstDiscoveredAt), asc(organizations.displayName))
      .limit(Math.min(filters.limit ?? 100, 250));

    return rows.map((row) => ({
      ...row,
      status: leadStatusSchema.parse(row.status),
      evidenceCount: Number(row.evidenceCount)
    }));
  }

  public async getLead(leadId: string): Promise<LeadDetail | null> {
    const [row] = await this.database
      .select({
        id: leads.id,
        brandName: organizations.displayName,
        productSummary: organizations.productSummary,
        canonicalDomain: organizations.canonicalDomain,
        country: organizations.country,
        regionCode: regions.code,
        stage: organizations.stage,
        score: leads.icpScore,
        scoreConfidence: leads.scoreConfidence,
        status: leads.status,
        discoverySignal: leads.discoverySignal,
        currentOwner: leads.currentOwner,
        nextActionAt: leads.nextActionAt,
        firstDiscoveredAt: leads.firstDiscoveredAt,
        hardExclusion: leads.hardExclusion,
        exclusionReason: leads.exclusionReason
      })
      .from(leads)
      .innerJoin(organizations, eq(leads.organizationId, organizations.id))
      .leftJoin(regions, eq(organizations.regionId, regions.id))
      .where(eq(leads.id, leadId))
      .limit(1);

    if (row === undefined) {
      return null;
    }

    const [evidenceRows, historyRows] = await Promise.all([
      this.database
        .select({
          id: evidence.id,
          factType: evidence.factType,
          claim: evidence.claim,
          quoteOrSummary: evidence.quoteOrSummary,
          sourceUrl: evidence.sourceUrl,
          observedAt: evidence.observedAt,
          confidence: evidence.confidence,
          isInference: evidence.isInference,
          version: evidence.version,
          createdBy: evidence.createdBy,
          createdAt: evidence.createdAt
        })
        .from(evidence)
        .where(and(eq(evidence.leadId, leadId), eq(evidence.state, "active")))
        .orderBy(desc(evidence.observedAt), desc(evidence.createdAt)),
      this.database
        .select()
        .from(leadStatusHistory)
        .where(eq(leadStatusHistory.leadId, leadId))
        .orderBy(desc(leadStatusHistory.createdAt))
    ]);

    return {
      ...row,
      status: leadStatusSchema.parse(row.status),
      evidenceCount: evidenceRows.length,
      evidence: evidenceRows,
      history: historyRows.map((history) => ({
        ...history,
        fromStatus: history.fromStatus === null ? null : leadStatusSchema.parse(history.fromStatus),
        toStatus: leadStatusSchema.parse(history.toStatus)
      }))
    };
  }

  public async ingestManualLead(
    input: ManualLeadIngestInput,
    actorId: string
  ): Promise<ManualIngestResult> {
    const normalizedUrl = normalizePublicUrl(input.sourceUrl);

    return this.database.transaction(async (transaction) => {
      const [source] = await transaction
        .insert(sources)
        .values({
          type: "manual_url",
          name: "Manual URL",
          baseUrl: `${new URL(normalizedUrl.url).origin}/`,
          termsStatus: "manual_review",
          robotsStatus: "not_checked"
        })
        .onConflictDoUpdate({
          target: [sources.type, sources.name],
          set: { updatedAt: new Date() }
        })
        .returning({ id: sources.id });

      if (source === undefined) {
        throw new Error("Manual source could not be resolved.");
      }

      const [document] = await transaction
        .insert(sourceDocuments)
        .values({
          sourceId: source.id,
          url: normalizedUrl.url,
          canonicalUrl: normalizedUrl.url,
          title: input.brandName,
          trustLevel: "user_provided",
          metadata: { submittedBy: actorId }
        })
        .onConflictDoUpdate({
          target: sourceDocuments.canonicalUrl,
          set: {
            url: normalizedUrl.url,
            title: input.brandName,
            metadata: { submittedBy: actorId }
          }
        })
        .returning({ id: sourceDocuments.id });

      if (document === undefined) {
        throw new Error("Source document could not be resolved.");
      }

      const region =
        input.regionCode === undefined
          ? undefined
          : (
              await transaction
                .select({ id: regions.id })
                .from(regions)
                .where(eq(regions.code, input.regionCode.toUpperCase()))
                .limit(1)
            )[0];

      const [insertedOrganization] = await transaction
        .insert(organizations)
        .values({
          normalizedName: normalizeOrganizationName(input.brandName),
          displayName: input.brandName,
          canonicalDomain: normalizedUrl.domain,
          country: input.country,
          stage: input.stage,
          ...(input.productSummary === undefined ? {} : { productSummary: input.productSummary }),
          ...(region === undefined ? {} : { regionId: region.id })
        })
        .onConflictDoNothing({ target: organizations.canonicalDomain })
        .returning({ id: organizations.id });

      const organization =
        insertedOrganization ??
        (
          await transaction
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.canonicalDomain, normalizedUrl.domain))
            .limit(1)
        )[0];

      if (organization === undefined) {
        throw new Error("Organization could not be resolved.");
      }

      const [insertedLead] = await transaction
        .insert(leads)
        .values({
          organizationId: organization.id,
          status: "discovered",
          icpScore: input.preliminaryScore,
          ...(input.discoverySignal === undefined ? {} : { discoverySignal: input.discoverySignal })
        })
        .onConflictDoNothing({ target: leads.organizationId })
        .returning({ id: leads.id });

      const lead =
        insertedLead ??
        (
          await transaction
            .select({ id: leads.id })
            .from(leads)
            .where(eq(leads.organizationId, organization.id))
            .limit(1)
        )[0];

      if (lead === undefined) {
        throw new Error("Lead could not be resolved.");
      }

      if (insertedLead !== undefined) {
        await transaction.insert(evidence).values({
          leadId: lead.id,
          sourceDocumentId: document.id,
          factType: "manual_discovery",
          claim: input.discoverySignal ?? "Manual URL submitted for research.",
          quoteOrSummary:
            input.productSummary ?? "The source was supplied manually and has not been fetched.",
          sourceUrl: normalizedUrl.url,
          observedAt: new Date(),
          confidence: 1,
          isInference: false,
          createdBy: actorId
        });

        await transaction.insert(leadStatusHistory).values({
          leadId: lead.id,
          fromStatus: null,
          toStatus: "discovered",
          reason: "Manual URL ingest",
          actorId
        });
      }

      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: insertedLead === undefined ? "lead.duplicate_detected" : "lead.created",
        entityType: "lead",
        entityId: lead.id,
        before: null,
        after: {
          sourceUrl: normalizedUrl.url,
          canonicalDomain: normalizedUrl.domain,
          created: insertedLead !== undefined
        }
      });

      return { leadId: lead.id, created: insertedLead !== undefined };
    });
  }

  public async updateLead(
    leadId: string,
    input: LeadUpdateInput,
    actorId: string
  ): Promise<LeadDetail> {
    await this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(leads)
        .where(eq(leads.id, leadId))
        .limit(1)
        .for("update");

      if (current === undefined) {
        throw new LeadNotFoundError();
      }

      const currentStatus = leadStatusSchema.parse(current.status);
      const nextStatus = input.status ?? currentStatus;
      if (!canTransitionLead(currentStatus, nextStatus)) {
        throw new InvalidLeadTransitionError(currentStatus, nextStatus);
      }

      await transaction
        .update(leads)
        .set({
          status: nextStatus,
          updatedAt: new Date(),
          ...(input.currentOwner === undefined ? {} : { currentOwner: input.currentOwner }),
          ...(input.nextActionAt === undefined
            ? {}
            : {
                nextActionAt: input.nextActionAt === null ? null : new Date(input.nextActionAt)
              })
        })
        .where(eq(leads.id, leadId));

      if (currentStatus !== nextStatus) {
        await transaction.insert(leadStatusHistory).values({
          leadId,
          fromStatus: currentStatus,
          toStatus: nextStatus,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          actorId
        });
      }

      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: "lead.updated",
        entityType: "lead",
        entityId: leadId,
        before: { status: currentStatus },
        after: { status: nextStatus }
      });
    });

    const updated = await this.getLead(leadId);
    if (updated === null) {
      throw new LeadNotFoundError();
    }
    return updated;
  }

  public async createEvidence(
    leadId: string,
    input: EvidenceInput,
    actorId: string
  ): Promise<EvidenceRecord> {
    const normalizedUrl = normalizePublicUrl(input.sourceUrl);

    return this.database.transaction(async (transaction) => {
      const leadExists =
        (
          await transaction
            .select({ id: leads.id })
            .from(leads)
            .where(eq(leads.id, leadId))
            .limit(1)
        )[0] !== undefined;
      if (!leadExists) {
        throw new LeadNotFoundError();
      }

      const [created] = await transaction
        .insert(evidence)
        .values({
          leadId,
          factType: input.factType,
          claim: input.claim,
          quoteOrSummary: input.quoteOrSummary,
          sourceUrl: normalizedUrl.url,
          observedAt: input.observedAt === undefined ? new Date() : new Date(input.observedAt),
          confidence: input.confidence,
          isInference: input.isInference,
          createdBy: actorId
        })
        .returning();

      if (created === undefined) {
        throw new Error("Evidence creation returned no record.");
      }

      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: "evidence.created",
        entityType: "evidence",
        entityId: created.id,
        before: null,
        after: { leadId, claim: input.claim, sourceUrl: normalizedUrl.url }
      });

      return created;
    });
  }

  public async reviseEvidence(
    leadId: string,
    evidenceId: string,
    input: EvidenceInput,
    actorId: string
  ): Promise<EvidenceRecord> {
    const normalizedUrl = normalizePublicUrl(input.sourceUrl);

    return this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(evidence)
        .where(
          and(
            eq(evidence.id, evidenceId),
            eq(evidence.leadId, leadId),
            eq(evidence.state, "active")
          )
        )
        .limit(1)
        .for("update");

      if (current === undefined) {
        throw new EvidenceNotFoundError();
      }

      const [created] = await transaction
        .insert(evidence)
        .values({
          leadId,
          ...(current.sourceDocumentId === null
            ? {}
            : { sourceDocumentId: current.sourceDocumentId }),
          factType: input.factType,
          claim: input.claim,
          quoteOrSummary: input.quoteOrSummary,
          sourceUrl: normalizedUrl.url,
          observedAt: input.observedAt === undefined ? new Date() : new Date(input.observedAt),
          confidence: input.confidence,
          isInference: input.isInference,
          version: current.version + 1,
          supersedesId: current.id,
          createdBy: actorId
        })
        .returning();

      if (created === undefined) {
        throw new Error("Evidence revision returned no record.");
      }

      await transaction
        .update(evidence)
        .set({ state: "superseded", supersededAt: new Date() })
        .where(eq(evidence.id, current.id));

      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: "evidence.revised",
        entityType: "evidence",
        entityId: created.id,
        before: { id: current.id, version: current.version, claim: current.claim },
        after: { id: created.id, version: created.version, claim: created.claim }
      });

      return created;
    });
  }

  public async deleteEvidence(leadId: string, evidenceId: string, actorId: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [deleted] = await transaction
        .update(evidence)
        .set({ state: "deleted", supersededAt: new Date() })
        .where(
          and(
            eq(evidence.id, evidenceId),
            eq(evidence.leadId, leadId),
            eq(evidence.state, "active")
          )
        )
        .returning({ id: evidence.id, claim: evidence.claim });

      if (deleted === undefined) {
        throw new EvidenceNotFoundError();
      }

      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: "evidence.deleted",
        entityType: "evidence",
        entityId: deleted.id,
        before: { state: "active", claim: deleted.claim },
        after: { state: "deleted" }
      });
    });
  }
}
