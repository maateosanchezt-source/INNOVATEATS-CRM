import { and, desc, eq, inArray } from "drizzle-orm";

import {
  entityResolutionDecisionSchema,
  icpScoreResultSchema,
  leadStatusSchema,
  normalizePublicUrl,
  sourceSnapshotSchema,
  type EntityResolutionDecision,
  type IcpScoreResult,
  type LeadStatus,
  type SourceSnapshot
} from "@innovateats/shared";

import type { AppDatabase } from "../client.js";
import {
  agentRuns,
  auditLog,
  evidence,
  founders,
  leads,
  leadScores,
  leadStatusHistory,
  organizations,
  sourceDocuments,
  sources
} from "../schema/index.js";
import { LeadNotFoundError } from "./crm.js";

export interface FounderRecord {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly publicProfileUrls: readonly string[];
  readonly confidence: number;
}

export interface LeadScoreRecord extends IcpScoreResult {
  readonly id: string;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export interface SnapshotRecordResult {
  readonly sourceDocumentId: string;
  readonly evidenceId: string;
  readonly captured: boolean;
  readonly leadStatus: LeadStatus;
}

export interface EntityResolutionResult {
  readonly status: LeadStatus;
  readonly duplicateOfOrganizationId: string | null;
}

export interface AgentRunStartInput {
  readonly agentName: string;
  readonly promptVersion: string;
  readonly model: string;
  readonly inputHash: string;
  readonly traceId?: string;
}

export interface AgentRunCompletion {
  readonly status: "succeeded" | "failed" | "blocked";
  readonly output?: Record<string, unknown>;
  readonly error?: string;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly costUsd?: number;
}

export interface AgentRunRecord {
  readonly id: string;
  readonly status: string;
  readonly created: boolean;
  readonly output: Record<string, unknown> | null;
}

export type ResearchActorType = "human" | "agent";

export class ResearchStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ResearchStateError";
  }
}

function normalizedName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

export class PostgresResearchRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async recordSourceSnapshot(
    leadId: string,
    rawSnapshot: SourceSnapshot,
    actorId: string
  ): Promise<SnapshotRecordResult> {
    const snapshot = sourceSnapshotSchema.parse(rawSnapshot);

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

      const [source] = await transaction
        .insert(sources)
        .values({
          type: "secure_fetch",
          name: `Secure public fetch: ${new URL(snapshot.finalUrl).origin}`,
          baseUrl: new URL(snapshot.finalUrl).origin,
          termsStatus: "manual_review",
          robotsStatus: "allowed",
          config: { pinnedDns: true, scriptsExecuted: false }
        })
        .onConflictDoUpdate({
          target: [sources.type, sources.name],
          set: { updatedAt: new Date() }
        })
        .returning({ id: sources.id });
      if (source === undefined) {
        throw new Error("Secure-fetch source could not be resolved.");
      }

      const [createdDocument] = await transaction
        .insert(sourceDocuments)
        .values({
          sourceId: source.id,
          url: snapshot.finalUrl,
          canonicalUrl: snapshot.finalUrl,
          fetchedAt: new Date(snapshot.fetchedAt),
          contentHash: snapshot.contentHash,
          title: snapshot.title,
          extractedText: snapshot.extractedText,
          trustLevel: "primary",
          metadata: {
            requestedUrl: snapshot.requestedUrl,
            contentType: snapshot.contentType,
            byteLength: snapshot.byteLength,
            redirectCount: snapshot.redirectCount,
            resolvedAddresses: snapshot.resolvedAddresses,
            robotsDecision: snapshot.robotsDecision,
            untrustedContent: true
          }
        })
        .onConflictDoNothing()
        .returning({ id: sourceDocuments.id });

      const document =
        createdDocument ??
        (
          await transaction
            .select({ id: sourceDocuments.id })
            .from(sourceDocuments)
            .where(
              and(
                eq(sourceDocuments.canonicalUrl, snapshot.finalUrl),
                eq(sourceDocuments.contentHash, snapshot.contentHash)
              )
            )
            .limit(1)
        )[0];
      if (document === undefined) {
        throw new Error("Source snapshot could not be resolved.");
      }

      const [existingEvidence] = await transaction
        .select({ id: evidence.id })
        .from(evidence)
        .where(
          and(
            eq(evidence.leadId, leadId),
            eq(evidence.sourceDocumentId, document.id),
            eq(evidence.state, "active")
          )
        )
        .limit(1);

      const [createdEvidence] =
        existingEvidence === undefined
          ? await transaction
              .insert(evidence)
              .values({
                leadId,
                sourceDocumentId: document.id,
                factType: "source_snapshot",
                claim: "A public source snapshot was captured for research.",
                quoteOrSummary:
                  snapshot.extractedText.slice(0, 2_000) || "The public source contained no text.",
                sourceUrl: snapshot.finalUrl,
                observedAt: new Date(snapshot.fetchedAt),
                confidence: 1,
                isInference: false,
                createdBy: actorId
              })
              .returning({ id: evidence.id })
          : [undefined];
      const evidenceRecord = createdEvidence ?? existingEvidence;
      if (evidenceRecord === undefined) {
        throw new Error("Snapshot evidence could not be resolved.");
      }

      const currentStatus = leadStatusSchema.parse(lead.status);
      const nextStatus = currentStatus === "entity_resolved" ? "researched" : currentStatus;
      await transaction
        .update(leads)
        .set({
          status: nextStatus,
          lastResearchedAt: new Date(snapshot.fetchedAt),
          updatedAt: new Date()
        })
        .where(eq(leads.id, leadId));

      if (currentStatus !== nextStatus) {
        await transaction.insert(leadStatusHistory).values({
          leadId,
          fromStatus: currentStatus,
          toStatus: nextStatus,
          reason: "Secure public-source snapshot captured",
          actorId
        });
      }

      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action:
          createdDocument === undefined
            ? "source_document.snapshot_reused"
            : "source_document.snapshot_captured",
        entityType: "source_document",
        entityId: document.id,
        before: null,
        after: {
          leadId,
          contentHash: snapshot.contentHash,
          finalUrl: snapshot.finalUrl,
          robotsDecision: snapshot.robotsDecision
        }
      });

      return {
        sourceDocumentId: document.id,
        evidenceId: evidenceRecord.id,
        captured: createdDocument !== undefined,
        leadStatus: nextStatus
      };
    });
  }

  public async applyEntityResolution(
    leadId: string,
    rawDecision: EntityResolutionDecision,
    actorId: string,
    actorType: ResearchActorType = "human"
  ): Promise<EntityResolutionResult> {
    const decision = entityResolutionDecisionSchema.parse(rawDecision);

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
      if (currentStatus !== "discovered" && currentStatus !== "entity_resolved") {
        throw new ResearchStateError(`Entity resolution is not valid from ${currentStatus}.`);
      }

      const domainIsCanonical = (() => {
        try {
          const normalizedDomain = normalizePublicUrl(
            `https://${decision.proposal.canonicalDomain}`
          ).domain;
          return normalizedDomain === decision.proposal.canonicalDomain;
        } catch {
          return false;
        }
      })();
      const deterministicMergeAllowed =
        decision.decision === "resolved" &&
        decision.mergeAllowed &&
        decision.proposal.confidence >= 0.85 &&
        domainIsCanonical;

      if (!deterministicMergeAllowed) {
        await transaction.insert(auditLog).values({
          actorType,
          actorId,
          action: "entity_resolution.manual_review",
          entityType: "lead",
          entityId: leadId,
          before: { status: currentStatus },
          after: {
            confidence: decision.proposal.confidence,
            reason: decision.reason
          }
        });
        return { status: currentStatus, duplicateOfOrganizationId: null };
      }

      const [matchingOrganization] = await transaction
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.canonicalDomain, decision.proposal.canonicalDomain))
        .limit(1);

      if (matchingOrganization !== undefined && matchingOrganization.id !== lead.organizationId) {
        await transaction
          .update(leads)
          .set({ status: "duplicate", updatedAt: new Date() })
          .where(eq(leads.id, leadId));
        await transaction.insert(leadStatusHistory).values({
          leadId,
          fromStatus: currentStatus,
          toStatus: "duplicate",
          reason: `Canonical organization already exists: ${matchingOrganization.id}`,
          actorId
        });
        await transaction.insert(auditLog).values({
          actorType,
          actorId,
          action: "entity_resolution.duplicate",
          entityType: "lead",
          entityId: leadId,
          before: { status: currentStatus },
          after: { duplicateOfOrganizationId: matchingOrganization.id }
        });
        return {
          status: "duplicate",
          duplicateOfOrganizationId: matchingOrganization.id
        };
      }

      await transaction
        .update(organizations)
        .set({
          displayName: decision.proposal.canonicalOrganization,
          normalizedName: normalizedName(decision.proposal.canonicalOrganization),
          canonicalDomain: decision.proposal.canonicalDomain,
          updatedAt: new Date()
        })
        .where(eq(organizations.id, lead.organizationId));

      for (const founder of decision.proposal.founders) {
        const founderName = normalizedName(founder.name);
        await transaction
          .insert(founders)
          .values({
            organizationId: lead.organizationId,
            name: founder.name,
            normalizedName: founderName,
            role: founder.role,
            publicProfileUrls: founder.publicProfileUrls,
            confidence: founder.confidence
          })
          .onConflictDoUpdate({
            target: [founders.organizationId, founders.normalizedName],
            set: {
              name: founder.name,
              role: founder.role,
              publicProfileUrls: founder.publicProfileUrls,
              confidence: founder.confidence,
              updatedAt: new Date()
            }
          });
      }

      const nextStatus = "entity_resolved";
      await transaction
        .update(leads)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(eq(leads.id, leadId));
      if (currentStatus !== nextStatus) {
        await transaction.insert(leadStatusHistory).values({
          leadId,
          fromStatus: currentStatus,
          toStatus: nextStatus,
          reason: decision.reason,
          actorId
        });
      }
      await transaction.insert(auditLog).values({
        actorType,
        actorId,
        action: "entity_resolution.applied",
        entityType: "lead",
        entityId: leadId,
        before: { status: currentStatus },
        after: {
          status: nextStatus,
          canonicalDomain: decision.proposal.canonicalDomain,
          confidence: decision.proposal.confidence
        }
      });

      return { status: nextStatus, duplicateOfOrganizationId: null };
    });
  }

  public async saveLeadScore(
    leadId: string,
    rawScore: IcpScoreResult,
    actorId: string,
    actorType: ResearchActorType = "human"
  ): Promise<LeadScoreRecord> {
    const score = icpScoreResultSchema.parse(rawScore);

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
      if (currentStatus !== "researched" && currentStatus !== "scored") {
        throw new ResearchStateError(`ICP scoring is not valid from ${currentStatus}.`);
      }

      const uniqueEvidenceIds = [...new Set(score.evidenceIds)];
      const matchingEvidence = await transaction
        .select({ id: evidence.id })
        .from(evidence)
        .where(
          and(
            eq(evidence.leadId, leadId),
            eq(evidence.state, "active"),
            inArray(evidence.id, uniqueEvidenceIds)
          )
        );
      if (matchingEvidence.length !== uniqueEvidenceIds.length) {
        throw new ResearchStateError(
          "Every score evidence ID must reference active evidence on the same lead."
        );
      }

      const [created] = await transaction
        .insert(leadScores)
        .values({
          leadId,
          rubricVersion: score.rubricVersion,
          breakdown: score.breakdown,
          explanations: score.explanations,
          total: score.total,
          confidence: score.confidence,
          evidenceIds: score.evidenceIds,
          missingInformation: score.missingInformation,
          hardExclusion: score.hardExclusion,
          exclusionReason: score.exclusionReason,
          recommendedAction: score.recommendedAction,
          createdBy: actorId
        })
        .returning();
      if (created === undefined) {
        throw new Error("Lead score creation returned no record.");
      }

      if (currentStatus === "researched") {
        await transaction.insert(leadStatusHistory).values({
          leadId,
          fromStatus: "researched",
          toStatus: "scored",
          reason: `ICP ${score.rubricVersion}: ${score.total}/100`,
          actorId
        });
      }

      const nextStatus = score.hardExclusion ? "rejected_icp" : "scored";
      if (score.hardExclusion) {
        await transaction.insert(leadStatusHistory).values({
          leadId,
          fromStatus: "scored",
          toStatus: "rejected_icp",
          reason: score.exclusionReason,
          actorId
        });
      }

      await transaction
        .update(leads)
        .set({
          status: nextStatus,
          icpScore: score.total,
          scoreConfidence: score.confidence,
          hardExclusion: score.hardExclusion,
          exclusionReason: score.exclusionReason,
          updatedAt: new Date()
        })
        .where(eq(leads.id, leadId));

      await transaction.insert(auditLog).values({
        actorType,
        actorId,
        action: "lead_score.created",
        entityType: "lead_score",
        entityId: created.id,
        before: { leadStatus: currentStatus, leadScore: lead.icpScore },
        after: {
          leadId,
          leadStatus: nextStatus,
          total: score.total,
          confidence: score.confidence,
          hardExclusion: score.hardExclusion,
          recommendedAction: score.recommendedAction
        }
      });

      return {
        id: created.id,
        rubricVersion: score.rubricVersion,
        breakdown: score.breakdown,
        explanations: score.explanations,
        total: score.total,
        confidence: score.confidence,
        hardExclusion: score.hardExclusion,
        exclusionReason: score.exclusionReason,
        missingInformation: score.missingInformation,
        evidenceIds: score.evidenceIds,
        recommendedAction: score.recommendedAction,
        createdBy: created.createdBy,
        createdAt: created.createdAt
      };
    });
  }

  public async getLatestLeadScore(leadId: string): Promise<LeadScoreRecord | null> {
    const [row] = await this.database
      .select()
      .from(leadScores)
      .where(eq(leadScores.leadId, leadId))
      .orderBy(desc(leadScores.createdAt))
      .limit(1);
    if (row === undefined) {
      return null;
    }

    const parsed = icpScoreResultSchema.parse({
      rubricVersion: row.rubricVersion,
      breakdown: row.breakdown,
      explanations: row.explanations,
      total: row.total,
      confidence: row.confidence,
      hardExclusion: row.hardExclusion,
      exclusionReason: row.exclusionReason,
      missingInformation: row.missingInformation,
      evidenceIds: row.evidenceIds,
      recommendedAction: row.recommendedAction
    });
    return {
      id: row.id,
      ...parsed,
      createdBy: row.createdBy,
      createdAt: row.createdAt
    };
  }

  public async listFounders(organizationId: string): Promise<readonly FounderRecord[]> {
    return this.database
      .select({
        id: founders.id,
        name: founders.name,
        role: founders.role,
        publicProfileUrls: founders.publicProfileUrls,
        confidence: founders.confidence
      })
      .from(founders)
      .where(eq(founders.organizationId, organizationId))
      .orderBy(desc(founders.confidence), founders.name);
  }

  public async startAgentRun(input: AgentRunStartInput): Promise<AgentRunRecord> {
    if (!/^[a-f0-9]{64}$/u.test(input.inputHash)) {
      throw new Error("Agent input hash must be a lowercase SHA-256 digest.");
    }

    return this.database.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(agentRuns)
        .values({
          agentName: input.agentName,
          promptVersion: input.promptVersion,
          model: input.model,
          inputHash: input.inputHash,
          ...(input.traceId === undefined ? {} : { traceId: input.traceId })
        })
        .onConflictDoNothing()
        .returning({
          id: agentRuns.id,
          status: agentRuns.status,
          output: agentRuns.output
        });
      if (created !== undefined) {
        await transaction.insert(auditLog).values({
          actorType: "system",
          actorId: input.agentName,
          action: "agent_run.started",
          entityType: "agent_run",
          entityId: created.id,
          before: null,
          after: {
            promptVersion: input.promptVersion,
            model: input.model,
            inputHash: input.inputHash
          }
        });
        return { ...created, created: true };
      }

      const [existing] = await transaction
        .select({
          id: agentRuns.id,
          status: agentRuns.status,
          output: agentRuns.output
        })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.agentName, input.agentName),
            eq(agentRuns.promptVersion, input.promptVersion),
            eq(agentRuns.inputHash, input.inputHash)
          )
        )
        .limit(1);
      if (existing === undefined) {
        throw new Error("Agent run could not be resolved.");
      }
      return { ...existing, created: false };
    });
  }

  public async completeAgentRun(runId: string, completion: AgentRunCompletion): Promise<void> {
    if ((completion.tokensIn ?? 0) < 0 || (completion.tokensOut ?? 0) < 0) {
      throw new Error("Agent token counts cannot be negative.");
    }
    if ((completion.costUsd ?? 0) < 0) {
      throw new Error("Agent cost cannot be negative.");
    }

    await this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ status: agentRuns.status, agentName: agentRuns.agentName })
        .from(agentRuns)
        .where(eq(agentRuns.id, runId))
        .limit(1)
        .for("update");
      if (existing === undefined) {
        throw new Error("Agent run not found.");
      }
      if (existing.status !== "running") {
        if (existing.status === completion.status) {
          return;
        }
        throw new Error(`Agent run is already ${existing.status}.`);
      }

      await transaction
        .update(agentRuns)
        .set({
          status: completion.status,
          output: completion.output ?? null,
          error: completion.error ?? null,
          tokensIn: completion.tokensIn ?? 0,
          tokensOut: completion.tokensOut ?? 0,
          costUsd: String(completion.costUsd ?? 0),
          completedAt: new Date()
        })
        .where(eq(agentRuns.id, runId));
      await transaction.insert(auditLog).values({
        actorType: "agent",
        actorId: existing.agentName,
        action: "agent_run.completed",
        entityType: "agent_run",
        entityId: runId,
        before: { status: "running" },
        after: {
          status: completion.status,
          tokensIn: completion.tokensIn ?? 0,
          tokensOut: completion.tokensOut ?? 0,
          costUsd: completion.costUsd ?? 0,
          hasOutput: completion.output !== undefined,
          hasError: completion.error !== undefined
        }
      });
    });
  }
}
