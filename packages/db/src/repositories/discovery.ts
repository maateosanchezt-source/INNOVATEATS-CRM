import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, lte, sql } from "drizzle-orm";

import {
  createDiscoveryCampaignSchema,
  discoveryCampaignStatusSchema,
  discoveryCandidateDecisionSchema,
  discoveryCandidateStatusSchema,
  discoveryRunStatusSchema,
  discoveryRunTriggerSchema,
  discoveryWorkflowId,
  type CreateDiscoveryCampaignInput,
  type DiscoveryCampaignStatus,
  type DiscoveryCandidateDecision,
  type DiscoveryCandidateStatus,
  type DiscoveryRunStatus,
  type DiscoveryRunTrigger,
  type DiscoverySeedKind,
  type DiscoveryTrack,
  type InstagramProfileSnapshot
} from "@innovateats/shared";

import type { AppDatabase } from "../client.js";
import {
  auditLog,
  discoveryCampaigns,
  discoveryCandidateSources,
  discoveryCandidates,
  discoveryProviderActions,
  discoveryRuns,
  discoverySeeds,
  regions
} from "../schema/index.js";

export interface DiscoveryCampaignView {
  readonly id: string;
  readonly name: string;
  readonly regionCode: string;
  readonly status: DiscoveryCampaignStatus;
  readonly targetCandidates: number;
  readonly dailyCandidateCap: number;
  readonly resultsPerSeed: number;
  readonly minFollowers: number;
  readonly maxFollowers: number;
  readonly activeWithinDays: number;
  readonly scheduleIntervalHours: number;
  readonly autoSchedule: boolean;
  readonly nextRunAt: Date | null;
  readonly lastRunAt: Date | null;
  readonly candidateCount: number;
  readonly needsReviewCount: number;
  readonly approvedCount: number;
  readonly runCount: number;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export interface DiscoverySeedRecord {
  readonly id: string;
  readonly kind: DiscoverySeedKind;
  readonly value: string;
  readonly normalizedValue: string;
  readonly track: DiscoveryTrack;
  readonly priority: number;
}

export interface DiscoveryRunRecord {
  readonly id: string;
  readonly campaignId: string;
  readonly workflowId: string;
  readonly idempotencyKey: string;
  readonly trigger: DiscoveryRunTrigger;
  readonly status: DiscoveryRunStatus;
  readonly discoveredCount: number;
  readonly enrichedCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly estimatedCostUsd: number;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly queuedBy: string;
  readonly queuedAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
}

export interface DiscoveryRunContext {
  readonly run: DiscoveryRunRecord;
  readonly campaign: Omit<
    DiscoveryCampaignView,
    "candidateCount" | "needsReviewCount" | "approvedCount" | "runCount"
  >;
  readonly seeds: readonly DiscoverySeedRecord[];
  readonly remainingTarget: number;
  readonly remainingDailyCapacity: number;
}

export interface DiscoveryCandidateView {
  readonly id: string;
  readonly campaignId: string;
  readonly username: string;
  readonly profileUrl: string;
  readonly fullName: string | null;
  readonly biography: string | null;
  readonly externalUrl: string | null;
  readonly followersCount: number | null;
  readonly postsCount: number | null;
  readonly isBusinessAccount: boolean | null;
  readonly isPrivate: boolean;
  readonly isVerified: boolean;
  readonly businessCategory: string | null;
  readonly track: DiscoveryTrack;
  readonly country: string;
  readonly latestPostAt: Date | null;
  readonly status: DiscoveryCandidateStatus;
  readonly filterReasons: readonly string[];
  readonly decisionReason: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
}

export interface CandidateSourceInput {
  readonly seedId: string;
  readonly providerResultId: string;
}

export interface DiscoveredCandidateInput {
  readonly profile: InstagramProfileSnapshot;
  readonly track: DiscoveryTrack;
  readonly sources: readonly CandidateSourceInput[];
}

export interface CompleteDiscoveryRunInput {
  readonly candidates: readonly DiscoveredCandidateInput[];
  readonly discoveredCount: number;
  readonly estimatedCostUsd?: number;
}

export interface ProviderActionRecord {
  readonly id: string;
  readonly runId: string;
  readonly seedId: string | null;
  readonly actionKey: string;
  readonly provider: string;
  readonly actorId: string;
  readonly inputHash: string;
  readonly status: "claimed" | "running" | "succeeded" | "failed" | "unknown";
  readonly providerRunId: string | null;
  readonly datasetId: string | null;
  readonly itemCount: number;
  readonly errorCode: string | null;
  readonly created: boolean;
}

export interface ClaimProviderActionInput {
  readonly runId: string;
  readonly seedId?: string;
  readonly actionKey: string;
  readonly actorId: string;
  readonly inputHash: string;
}

export class DiscoveryStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DiscoveryStateError";
  }
}

function normalizedSeedValue(kind: DiscoverySeedKind, value: string): string {
  const trimmed = value.trim().toLowerCase();
  return kind === "hashtag" ? trimmed.replace(/^#/u, "") : trimmed;
}

function numeric(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function safeErrorMessage(message: string): string {
  return message.replace(/(?:sk-proj-|apify_api_)[A-Za-z0-9_-]+/gu, "[redacted]").slice(0, 500);
}

function providerActionRecord(
  row: typeof discoveryProviderActions.$inferSelect,
  created: boolean
): ProviderActionRecord {
  const status = row.status;
  if (!["claimed", "running", "succeeded", "failed", "unknown"].includes(status)) {
    throw new DiscoveryStateError("The provider action has an unknown status.");
  }
  return {
    ...row,
    status: status as ProviderActionRecord["status"],
    created
  };
}

export class PostgresDiscoveryRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async createCampaign(
    rawInput: CreateDiscoveryCampaignInput,
    actorId: string
  ): Promise<DiscoveryCampaignView> {
    const input = createDiscoveryCampaignSchema.parse(rawInput);
    const campaignId = await this.database.transaction(async (transaction) => {
      const [region] = await transaction
        .select({ id: regions.id })
        .from(regions)
        .where(and(eq(regions.code, input.regionCode), eq(regions.enabled, true)))
        .limit(1);
      if (region === undefined) {
        throw new DiscoveryStateError("The selected discovery region is not enabled.");
      }

      const [campaign] = await transaction
        .insert(discoveryCampaigns)
        .values({
          name: input.name,
          regionId: region.id,
          targetCandidates: input.targetCandidates,
          dailyCandidateCap: input.dailyCandidateCap,
          resultsPerSeed: input.resultsPerSeed,
          minFollowers: input.minFollowers,
          maxFollowers: input.maxFollowers,
          activeWithinDays: input.activeWithinDays,
          scheduleIntervalHours: input.scheduleIntervalHours,
          autoSchedule: input.autoSchedule,
          ...(input.autoSchedule ? { nextRunAt: new Date() } : {}),
          createdBy: actorId
        })
        .returning({ id: discoveryCampaigns.id });
      if (campaign === undefined) {
        throw new DiscoveryStateError("The discovery campaign could not be created.");
      }

      await transaction.insert(discoverySeeds).values(
        input.seeds.map((seed) => ({
          campaignId: campaign.id,
          kind: seed.kind,
          value: seed.value,
          normalizedValue: normalizedSeedValue(seed.kind, seed.value),
          track: seed.track,
          priority: seed.priority
        }))
      );
      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: "discovery_campaign.created",
        entityType: "discovery_campaign",
        entityId: campaign.id,
        before: null,
        after: {
          regionCode: input.regionCode,
          targetCandidates: input.targetCandidates,
          autoSchedule: input.autoSchedule,
          seedCount: input.seeds.length
        }
      });
      return campaign.id;
    });

    const campaign = await this.getCampaign(campaignId);
    if (campaign === null) {
      throw new DiscoveryStateError("The created discovery campaign could not be loaded.");
    }
    return campaign;
  }

  public async listCampaigns(): Promise<readonly DiscoveryCampaignView[]> {
    const rows = await this.database
      .select({
        id: discoveryCampaigns.id,
        name: discoveryCampaigns.name,
        regionCode: regions.code,
        status: discoveryCampaigns.status,
        targetCandidates: discoveryCampaigns.targetCandidates,
        dailyCandidateCap: discoveryCampaigns.dailyCandidateCap,
        resultsPerSeed: discoveryCampaigns.resultsPerSeed,
        minFollowers: discoveryCampaigns.minFollowers,
        maxFollowers: discoveryCampaigns.maxFollowers,
        activeWithinDays: discoveryCampaigns.activeWithinDays,
        scheduleIntervalHours: discoveryCampaigns.scheduleIntervalHours,
        autoSchedule: discoveryCampaigns.autoSchedule,
        nextRunAt: discoveryCampaigns.nextRunAt,
        lastRunAt: discoveryCampaigns.lastRunAt,
        candidateCount: sql<number>`(
          SELECT count(*)::integer FROM discovery_candidates
          WHERE discovery_candidates.campaign_id = ${discoveryCampaigns.id}
        )`,
        needsReviewCount: sql<number>`(
          SELECT count(*)::integer FROM discovery_candidates
          WHERE discovery_candidates.campaign_id = ${discoveryCampaigns.id}
            AND discovery_candidates.status = 'needs_review'
        )`,
        approvedCount: sql<number>`(
          SELECT count(*)::integer FROM discovery_candidates
          WHERE discovery_candidates.campaign_id = ${discoveryCampaigns.id}
            AND discovery_candidates.status IN ('approved', 'imported')
        )`,
        runCount: sql<number>`(
          SELECT count(*)::integer FROM discovery_runs
          WHERE discovery_runs.campaign_id = ${discoveryCampaigns.id}
        )`,
        createdBy: discoveryCampaigns.createdBy,
        createdAt: discoveryCampaigns.createdAt
      })
      .from(discoveryCampaigns)
      .innerJoin(regions, eq(discoveryCampaigns.regionId, regions.id))
      .orderBy(desc(discoveryCampaigns.createdAt));

    return rows.map((row) => ({
      ...row,
      status: discoveryCampaignStatusSchema.parse(row.status),
      candidateCount: numeric(row.candidateCount),
      needsReviewCount: numeric(row.needsReviewCount),
      approvedCount: numeric(row.approvedCount),
      runCount: numeric(row.runCount)
    }));
  }

  public async getCampaign(campaignId: string): Promise<DiscoveryCampaignView | null> {
    return (await this.listCampaigns()).find((campaign) => campaign.id === campaignId) ?? null;
  }

  public async listCandidates(
    filters: {
      readonly campaignId?: string;
      readonly status?: DiscoveryCandidateStatus;
      readonly limit?: number;
    } = {}
  ): Promise<readonly DiscoveryCandidateView[]> {
    const rows = await this.database
      .select({
        id: discoveryCandidates.id,
        campaignId: discoveryCandidates.campaignId,
        username: discoveryCandidates.username,
        profileUrl: discoveryCandidates.profileUrl,
        fullName: discoveryCandidates.fullName,
        biography: discoveryCandidates.biography,
        externalUrl: discoveryCandidates.externalUrl,
        followersCount: discoveryCandidates.followersCount,
        postsCount: discoveryCandidates.postsCount,
        isBusinessAccount: discoveryCandidates.isBusinessAccount,
        isPrivate: discoveryCandidates.isPrivate,
        isVerified: discoveryCandidates.isVerified,
        businessCategory: discoveryCandidates.businessCategory,
        track: discoveryCandidates.track,
        country: discoveryCandidates.country,
        latestPostAt: discoveryCandidates.latestPostAt,
        status: discoveryCandidates.status,
        filterReasons: discoveryCandidates.filterReasons,
        decisionReason: discoveryCandidates.decisionReason,
        decidedBy: discoveryCandidates.decidedBy,
        decidedAt: discoveryCandidates.decidedAt,
        firstSeenAt: discoveryCandidates.firstSeenAt,
        lastSeenAt: discoveryCandidates.lastSeenAt
      })
      .from(discoveryCandidates)
      .where(
        and(
          ...(filters.campaignId === undefined
            ? []
            : [eq(discoveryCandidates.campaignId, filters.campaignId)]),
          ...(filters.status === undefined ? [] : [eq(discoveryCandidates.status, filters.status)])
        )
      )
      .orderBy(desc(discoveryCandidates.lastSeenAt), asc(discoveryCandidates.username))
      .limit(Math.min(filters.limit ?? 100, 500));

    return rows.map((row) => ({
      ...row,
      status: discoveryCandidateStatusSchema.parse(row.status)
    }));
  }

  public async decideCandidate(
    candidateId: string,
    rawDecision: DiscoveryCandidateDecision,
    actorId: string
  ): Promise<void> {
    const decision = discoveryCandidateDecisionSchema.parse(rawDecision);
    await this.database.transaction(async (transaction) => {
      const [candidate] = await transaction
        .select({ status: discoveryCandidates.status })
        .from(discoveryCandidates)
        .where(eq(discoveryCandidates.id, candidateId))
        .limit(1)
        .for("update");
      if (candidate === undefined) {
        throw new DiscoveryStateError("Discovery candidate not found.");
      }
      if (candidate.status !== "needs_review") {
        throw new DiscoveryStateError("Discovery candidate decisions are final.");
      }

      const now = new Date();
      await transaction
        .update(discoveryCandidates)
        .set({
          status: decision.decision,
          decisionReason: decision.reason,
          decidedBy: actorId,
          decidedAt: now,
          updatedAt: now
        })
        .where(eq(discoveryCandidates.id, candidateId));
      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: `discovery_candidate.${decision.decision}`,
        entityType: "discovery_candidate",
        entityId: candidateId,
        before: { status: "needs_review" },
        after: { status: decision.decision, reason: decision.reason }
      });
    });
  }

  public async queueRun(
    campaignId: string,
    trigger: DiscoveryRunTrigger,
    actorId: string,
    idempotencyKey = `manual:${campaignId}:${randomUUID()}`
  ): Promise<DiscoveryRunRecord> {
    const parsedTrigger = discoveryRunTriggerSchema.parse(trigger);
    const runId = randomUUID();
    const workflowId = discoveryWorkflowId(runId);
    const run = await this.database.transaction(async (transaction) => {
      const [campaign] = await transaction
        .select({ status: discoveryCampaigns.status })
        .from(discoveryCampaigns)
        .where(eq(discoveryCampaigns.id, campaignId))
        .limit(1)
        .for("update");
      if (campaign === undefined) {
        throw new DiscoveryStateError("Discovery campaign not found.");
      }
      if (campaign.status !== "active") {
        throw new DiscoveryStateError("Only active discovery campaigns can run.");
      }

      const [inserted] = await transaction
        .insert(discoveryRuns)
        .values({
          id: runId,
          campaignId,
          workflowId,
          idempotencyKey,
          trigger: parsedTrigger,
          queuedBy: actorId
        })
        .onConflictDoNothing({ target: discoveryRuns.idempotencyKey })
        .returning();
      const resolved =
        inserted ??
        (
          await transaction
            .select()
            .from(discoveryRuns)
            .where(eq(discoveryRuns.idempotencyKey, idempotencyKey))
            .limit(1)
        )[0];
      if (resolved === undefined) {
        throw new DiscoveryStateError("The discovery run could not be queued.");
      }
      if (inserted !== undefined) {
        await transaction.insert(auditLog).values({
          actorType: parsedTrigger === "manual" ? "human" : "system",
          actorId,
          action: "discovery_run.queued",
          entityType: "discovery_run",
          entityId: resolved.id,
          before: null,
          after: { campaignId, trigger: parsedTrigger, workflowId: resolved.workflowId }
        });
      }
      return resolved;
    });
    return this.parseRun(run);
  }

  public async queueDueRuns(now = new Date()): Promise<readonly DiscoveryRunRecord[]> {
    const due = await this.database
      .select({
        id: discoveryCampaigns.id,
        nextRunAt: discoveryCampaigns.nextRunAt,
        scheduleIntervalHours: discoveryCampaigns.scheduleIntervalHours
      })
      .from(discoveryCampaigns)
      .where(
        and(
          eq(discoveryCampaigns.status, "active"),
          eq(discoveryCampaigns.autoSchedule, true),
          lte(discoveryCampaigns.nextRunAt, now)
        )
      )
      .orderBy(asc(discoveryCampaigns.nextRunAt))
      .limit(20);

    const queued: DiscoveryRunRecord[] = [];
    for (const campaign of due) {
      if (campaign.nextRunAt === null) {
        continue;
      }
      const run = await this.queueRun(
        campaign.id,
        "schedule",
        "discovery-scheduler",
        `schedule:${campaign.id}:${campaign.nextRunAt.toISOString()}`
      );
      queued.push(run);
      await this.database
        .update(discoveryCampaigns)
        .set({
          nextRunAt: new Date(
            campaign.nextRunAt.getTime() + campaign.scheduleIntervalHours * 60 * 60 * 1_000
          ),
          updatedAt: now
        })
        .where(
          and(
            eq(discoveryCampaigns.id, campaign.id),
            eq(discoveryCampaigns.nextRunAt, campaign.nextRunAt)
          )
        );
    }
    return queued;
  }

  public async listQueuedRuns(limit = 20): Promise<readonly DiscoveryRunRecord[]> {
    const rows = await this.database
      .select()
      .from(discoveryRuns)
      .where(eq(discoveryRuns.status, "queued"))
      .orderBy(asc(discoveryRuns.queuedAt))
      .limit(Math.min(limit, 100));
    return rows.map((row) => this.parseRun(row));
  }

  public async listRuns(campaignId?: string, limit = 20): Promise<readonly DiscoveryRunRecord[]> {
    const rows = await this.database
      .select()
      .from(discoveryRuns)
      .where(campaignId === undefined ? undefined : eq(discoveryRuns.campaignId, campaignId))
      .orderBy(desc(discoveryRuns.queuedAt))
      .limit(Math.min(limit, 100));
    return rows.map((row) => this.parseRun(row));
  }

  public async getRunContext(runId: string): Promise<DiscoveryRunContext> {
    const [row] = await this.database
      .select({
        run: discoveryRuns,
        campaign: discoveryCampaigns,
        regionCode: regions.code
      })
      .from(discoveryRuns)
      .innerJoin(discoveryCampaigns, eq(discoveryRuns.campaignId, discoveryCampaigns.id))
      .innerJoin(regions, eq(discoveryCampaigns.regionId, regions.id))
      .where(eq(discoveryRuns.id, runId))
      .limit(1);
    if (row === undefined) {
      throw new DiscoveryStateError("Discovery run not found.");
    }
    const seeds = await this.database
      .select({
        id: discoverySeeds.id,
        kind: discoverySeeds.kind,
        value: discoverySeeds.value,
        normalizedValue: discoverySeeds.normalizedValue,
        track: discoverySeeds.track,
        priority: discoverySeeds.priority
      })
      .from(discoverySeeds)
      .where(and(eq(discoverySeeds.campaignId, row.campaign.id), eq(discoverySeeds.active, true)))
      .orderBy(desc(discoverySeeds.priority), asc(discoverySeeds.createdAt));
    const [counts] = await this.database
      .select({
        total: sql<number>`count(*)::integer`,
        today: sql<number>`count(*) FILTER (
          WHERE ${discoveryCandidates.createdAt} >= now() - interval '24 hours'
        )::integer`
      })
      .from(discoveryCandidates)
      .where(eq(discoveryCandidates.campaignId, row.campaign.id));
    const total = numeric(counts?.total ?? 0);
    const today = numeric(counts?.today ?? 0);

    return {
      run: this.parseRun(row.run),
      campaign: {
        ...row.campaign,
        regionCode: row.regionCode,
        status: discoveryCampaignStatusSchema.parse(row.campaign.status)
      },
      seeds,
      remainingTarget: Math.max(0, row.campaign.targetCandidates - total),
      remainingDailyCapacity: Math.max(0, row.campaign.dailyCandidateCap - today)
    };
  }

  public async startRun(runId: string): Promise<void> {
    const now = new Date();
    const [updated] = await this.database
      .update(discoveryRuns)
      .set({ status: "running", startedAt: now, updatedAt: now })
      .where(and(eq(discoveryRuns.id, runId), eq(discoveryRuns.status, "queued")))
      .returning({ id: discoveryRuns.id });
    if (updated === undefined) {
      const [current] = await this.database
        .select({ status: discoveryRuns.status })
        .from(discoveryRuns)
        .where(eq(discoveryRuns.id, runId))
        .limit(1);
      if (current?.status !== "running") {
        throw new DiscoveryStateError("Discovery run cannot be started from its current state.");
      }
      return;
    }
    await this.database.insert(auditLog).values({
      actorType: "system",
      actorId: "discovery-worker",
      action: "discovery_run.started",
      entityType: "discovery_run",
      entityId: runId,
      before: { status: "queued" },
      after: { status: "running" }
    });
  }

  public async claimProviderAction(input: ClaimProviderActionInput): Promise<ProviderActionRecord> {
    const [inserted] = await this.database
      .insert(discoveryProviderActions)
      .values({
        runId: input.runId,
        ...(input.seedId === undefined ? {} : { seedId: input.seedId }),
        actionKey: input.actionKey,
        provider: "apify",
        actorId: input.actorId,
        inputHash: input.inputHash
      })
      .onConflictDoNothing({ target: discoveryProviderActions.actionKey })
      .returning();
    const resolved =
      inserted ??
      (
        await this.database
          .select()
          .from(discoveryProviderActions)
          .where(eq(discoveryProviderActions.actionKey, input.actionKey))
          .limit(1)
      )[0];
    if (resolved === undefined) {
      throw new DiscoveryStateError("Provider action claim could not be resolved.");
    }
    if (
      resolved.runId !== input.runId ||
      resolved.actorId !== input.actorId ||
      resolved.inputHash !== input.inputHash
    ) {
      throw new DiscoveryStateError("Provider action idempotency key was reused with other input.");
    }
    if (inserted !== undefined) {
      await this.database.insert(auditLog).values({
        actorType: "system",
        actorId: "discovery-worker",
        action: "discovery_provider_action.claimed",
        entityType: "discovery_provider_action",
        entityId: resolved.id,
        before: null,
        after: { runId: input.runId, actorId: input.actorId, actionKey: input.actionKey }
      });
    }
    return providerActionRecord(resolved, inserted !== undefined);
  }

  public async markProviderActionStarted(
    actionId: string,
    providerRunId: string,
    datasetId: string
  ): Promise<ProviderActionRecord> {
    const now = new Date();
    const [updated] = await this.database
      .update(discoveryProviderActions)
      .set({ status: "running", providerRunId, datasetId, startedAt: now })
      .where(
        and(
          eq(discoveryProviderActions.id, actionId),
          eq(discoveryProviderActions.status, "claimed")
        )
      )
      .returning();
    if (updated === undefined) {
      throw new DiscoveryStateError("Provider action could not be marked as started.");
    }
    await this.database.insert(auditLog).values({
      actorType: "system",
      actorId: "discovery-worker",
      action: "discovery_provider_action.started",
      entityType: "discovery_provider_action",
      entityId: actionId,
      before: { status: "claimed" },
      after: { status: "running", providerRunId, datasetId }
    });
    return providerActionRecord(updated, false);
  }

  public async completeProviderAction(actionId: string, itemCount: number): Promise<void> {
    const now = new Date();
    const [updated] = await this.database
      .update(discoveryProviderActions)
      .set({ status: "succeeded", itemCount, completedAt: now })
      .where(
        and(
          eq(discoveryProviderActions.id, actionId),
          eq(discoveryProviderActions.status, "running")
        )
      )
      .returning({ id: discoveryProviderActions.id });
    if (updated === undefined) {
      throw new DiscoveryStateError("Provider action could not be completed.");
    }
    await this.database.insert(auditLog).values({
      actorType: "system",
      actorId: "discovery-worker",
      action: "discovery_provider_action.succeeded",
      entityType: "discovery_provider_action",
      entityId: actionId,
      before: { status: "running" },
      after: { status: "succeeded", itemCount }
    });
  }

  public async failProviderAction(
    actionId: string,
    errorCode: string,
    ambiguous: boolean
  ): Promise<void> {
    const [current] = await this.database
      .select({ status: discoveryProviderActions.status })
      .from(discoveryProviderActions)
      .where(eq(discoveryProviderActions.id, actionId))
      .limit(1);
    if (current === undefined || ["succeeded", "failed", "unknown"].includes(current.status)) {
      return;
    }
    const nextStatus = ambiguous || current.status === "claimed" ? "unknown" : "failed";
    await this.database
      .update(discoveryProviderActions)
      .set({ status: nextStatus, errorCode: errorCode.slice(0, 100), completedAt: new Date() })
      .where(eq(discoveryProviderActions.id, actionId));
    await this.database.insert(auditLog).values({
      actorType: "system",
      actorId: "discovery-worker",
      action: `discovery_provider_action.${nextStatus}`,
      entityType: "discovery_provider_action",
      entityId: actionId,
      before: { status: current.status },
      after: { status: nextStatus, errorCode: errorCode.slice(0, 100) }
    });
  }

  public async completeRun(runId: string, input: CompleteDiscoveryRunInput): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select()
        .from(discoveryRuns)
        .where(eq(discoveryRuns.id, runId))
        .limit(1)
        .for("update");
      if (run === undefined || run.status !== "running") {
        throw new DiscoveryStateError("Only a running discovery run can be completed.");
      }
      const [campaign] = await transaction
        .select()
        .from(discoveryCampaigns)
        .where(eq(discoveryCampaigns.id, run.campaignId))
        .limit(1);
      if (campaign === undefined) {
        throw new DiscoveryStateError("Discovery campaign not found.");
      }

      let acceptedCount = 0;
      let rejectedCount = 0;
      for (const candidate of input.candidates) {
        const filterReasons = this.filterReasons(candidate.profile, campaign);
        if (filterReasons.length === 0) {
          acceptedCount += 1;
        } else {
          rejectedCount += 1;
        }
        const latestPostAt =
          candidate.profile.latestPostAt === null ? null : new Date(candidate.profile.latestPostAt);
        const [inserted] = await transaction
          .insert(discoveryCandidates)
          .values({
            campaignId: run.campaignId,
            firstRunId: runId,
            username: candidate.profile.username,
            profileUrl: candidate.profile.profileUrl,
            fullName: candidate.profile.fullName,
            biography: candidate.profile.biography,
            externalUrl: candidate.profile.externalUrl,
            followersCount: candidate.profile.followersCount,
            followsCount: candidate.profile.followsCount,
            postsCount: candidate.profile.postsCount,
            isBusinessAccount: candidate.profile.isBusinessAccount,
            isPrivate: candidate.profile.private,
            isVerified: candidate.profile.verified,
            businessCategory: candidate.profile.businessCategory,
            track: candidate.track,
            latestPostAt,
            snapshot: candidate.profile,
            filterReasons
          })
          .onConflictDoNothing({
            target: [discoveryCandidates.campaignId, discoveryCandidates.username]
          })
          .returning({ id: discoveryCandidates.id });
        const existing =
          inserted ??
          (
            await transaction
              .select({ id: discoveryCandidates.id })
              .from(discoveryCandidates)
              .where(
                and(
                  eq(discoveryCandidates.campaignId, run.campaignId),
                  eq(discoveryCandidates.username, candidate.profile.username)
                )
              )
              .limit(1)
          )[0];
        if (existing === undefined) {
          throw new DiscoveryStateError("Discovery candidate could not be resolved.");
        }
        if (inserted === undefined) {
          await transaction
            .update(discoveryCandidates)
            .set({
              profileUrl: candidate.profile.profileUrl,
              fullName: candidate.profile.fullName,
              biography: candidate.profile.biography,
              externalUrl: candidate.profile.externalUrl,
              followersCount: candidate.profile.followersCount,
              followsCount: candidate.profile.followsCount,
              postsCount: candidate.profile.postsCount,
              isBusinessAccount: candidate.profile.isBusinessAccount,
              isPrivate: candidate.profile.private,
              isVerified: candidate.profile.verified,
              businessCategory: candidate.profile.businessCategory,
              latestPostAt,
              snapshot: candidate.profile,
              filterReasons,
              lastSeenAt: new Date(),
              updatedAt: new Date()
            })
            .where(eq(discoveryCandidates.id, existing.id));
        }
        for (const source of candidate.sources) {
          await transaction
            .insert(discoveryCandidateSources)
            .values({
              candidateId: existing.id,
              runId,
              seedId: source.seedId,
              provider: "apify",
              providerResultId: source.providerResultId
            })
            .onConflictDoNothing();
        }
      }

      const now = new Date();
      await transaction
        .update(discoveryRuns)
        .set({
          status: "succeeded",
          discoveredCount: input.discoveredCount,
          enrichedCount: input.candidates.length,
          acceptedCount,
          rejectedCount,
          estimatedCostUsd: String(input.estimatedCostUsd ?? 0),
          completedAt: now,
          updatedAt: now
        })
        .where(eq(discoveryRuns.id, runId));
      const [campaignCount] = await transaction
        .select({ count: sql<number>`count(*)::integer` })
        .from(discoveryCandidates)
        .where(eq(discoveryCandidates.campaignId, run.campaignId));
      const total = numeric(campaignCount?.count ?? 0);
      await transaction
        .update(discoveryCampaigns)
        .set({
          lastRunAt: now,
          ...(total >= campaign.targetCandidates
            ? { status: "completed" as const, autoSchedule: false, nextRunAt: null }
            : {}),
          updatedAt: now
        })
        .where(eq(discoveryCampaigns.id, run.campaignId));
      await transaction.insert(auditLog).values({
        actorType: "system",
        actorId: "discovery-worker",
        action: "discovery_run.succeeded",
        entityType: "discovery_run",
        entityId: runId,
        before: { status: "running" },
        after: {
          status: "succeeded",
          discoveredCount: input.discoveredCount,
          enrichedCount: input.candidates.length,
          acceptedCount,
          rejectedCount
        }
      });
    });
  }

  public async failRun(runId: string, errorCode: string, errorMessage: string): Promise<void> {
    const [current] = await this.database
      .select({ status: discoveryRuns.status })
      .from(discoveryRuns)
      .where(eq(discoveryRuns.id, runId))
      .limit(1);
    if (current === undefined || ["succeeded", "failed", "cancelled"].includes(current.status)) {
      return;
    }
    const now = new Date();
    await this.database
      .update(discoveryRuns)
      .set({
        status: "failed",
        errorCode: errorCode.slice(0, 100),
        errorMessage: safeErrorMessage(errorMessage),
        completedAt: now,
        updatedAt: now
      })
      .where(eq(discoveryRuns.id, runId));
    await this.database.insert(auditLog).values({
      actorType: "system",
      actorId: "discovery-worker",
      action: "discovery_run.failed",
      entityType: "discovery_run",
      entityId: runId,
      before: { status: current.status },
      after: { status: "failed", errorCode: errorCode.slice(0, 100) }
    });
  }

  private parseRun(row: typeof discoveryRuns.$inferSelect): DiscoveryRunRecord {
    return {
      ...row,
      trigger: discoveryRunTriggerSchema.parse(row.trigger),
      status: discoveryRunStatusSchema.parse(row.status),
      estimatedCostUsd: numeric(row.estimatedCostUsd)
    };
  }

  private filterReasons(
    profile: InstagramProfileSnapshot,
    campaign: typeof discoveryCampaigns.$inferSelect
  ): readonly string[] {
    const reasons: string[] = [];
    if (profile.private) {
      reasons.push("private_profile");
    }
    if (profile.followersCount === null) {
      reasons.push("followers_unknown");
    } else if (profile.followersCount < campaign.minFollowers) {
      reasons.push("below_min_followers");
    } else if (profile.followersCount > campaign.maxFollowers) {
      reasons.push("above_max_followers");
    }
    if (profile.latestPostAt === null) {
      reasons.push("activity_unknown");
    } else {
      const cutoff = Date.now() - campaign.activeWithinDays * 24 * 60 * 60 * 1_000;
      if (new Date(profile.latestPostAt).getTime() < cutoff) {
        reasons.push("inactive_profile");
      }
    }
    return reasons;
  }
}
