import { and, desc, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import {
  evalRuns,
  goLiveChecklistItems,
  pilotReviewCheckpoints,
  pilotRuns
} from "../schema/index.js";

export type ChecklistStatus = "unknown" | "passed" | "blocked";

export interface EvalRunView {
  readonly id: string;
  readonly suiteVersion: string;
  readonly datasetVersion: string;
  readonly commitSha: string | null;
  readonly status: "running" | "passed" | "failed";
  readonly report: Readonly<Record<string, unknown>> | null;
  readonly automatedPassed: boolean | null;
  readonly pilotReady: boolean | null;
  readonly startedBy: string;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
}

export interface ChecklistItemView {
  readonly key: string;
  readonly category: string;
  readonly label: string;
  readonly status: ChecklistStatus;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly reviewedBy: string | null;
  readonly reviewedAt: Date | null;
}

export interface PilotRunView {
  readonly id: string;
  readonly name: string;
  readonly mode: "simulation" | "sandbox" | "production";
  readonly status: "planned" | "running" | "completed" | "aborted";
  readonly targetLeads: number;
  readonly allowedRegions: readonly string[];
  readonly dailyEmailCap: number;
  readonly reviewInterval: number;
  readonly humanApprovalRequired: boolean;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly externalAuthorized: boolean;
  readonly signedResultsBy: string | null;
  readonly signedResultsAt: Date | null;
}

export interface ReadinessSnapshot {
  readonly latestEval: EvalRunView | null;
  readonly checklist: readonly ChecklistItemView[];
  readonly pilot: PilotRunView | null;
  readonly checklistPassed: number;
  readonly checklistTotal: number;
  readonly productionUnlocked: false;
}

export class ReadinessStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ReadinessStateError";
  }
}

export class PostgresReadinessRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async recordEvalReport(input: {
    readonly suiteVersion: string;
    readonly datasetVersion: string;
    readonly commitSha?: string;
    readonly report: Record<string, unknown>;
    readonly automatedPassed: boolean;
    readonly pilotReady: boolean;
    readonly actorId: string;
    readonly completedAt?: Date;
  }): Promise<EvalRunView> {
    const completedAt = input.completedAt ?? new Date();
    const [row] = await this.database
      .insert(evalRuns)
      .values({
        suiteVersion: input.suiteVersion,
        datasetVersion: input.datasetVersion,
        ...(input.commitSha === undefined ? {} : { commitSha: input.commitSha }),
        status: input.automatedPassed ? "passed" : "failed",
        report: input.report,
        automatedPassed: input.automatedPassed,
        pilotReady: input.pilotReady,
        startedBy: input.actorId,
        startedAt: completedAt,
        completedAt
      })
      .returning();
    if (row === undefined) {
      throw new ReadinessStateError("The evaluation report could not be persisted.");
    }
    return row;
  }

  public async latestEval(): Promise<EvalRunView | null> {
    const [row] = await this.database
      .select()
      .from(evalRuns)
      .orderBy(desc(evalRuns.startedAt))
      .limit(1);
    return row ?? null;
  }

  public async listChecklist(): Promise<readonly ChecklistItemView[]> {
    return this.database
      .select({
        key: goLiveChecklistItems.key,
        category: goLiveChecklistItems.category,
        label: goLiveChecklistItems.label,
        status: goLiveChecklistItems.status,
        evidence: goLiveChecklistItems.evidence,
        reviewedBy: goLiveChecklistItems.reviewedBy,
        reviewedAt: goLiveChecklistItems.reviewedAt
      })
      .from(goLiveChecklistItems)
      .orderBy(goLiveChecklistItems.category, goLiveChecklistItems.key);
  }

  public async reviewChecklistItem(input: {
    readonly key: string;
    readonly status: ChecklistStatus;
    readonly evidence: Readonly<Record<string, unknown>>;
    readonly actorId: string;
    readonly now?: Date;
  }): Promise<ChecklistItemView> {
    if (input.status !== "unknown" && Object.keys(input.evidence).length === 0) {
      throw new ReadinessStateError("Passed or blocked checklist items require evidence.");
    }
    const now = input.now ?? new Date();
    const [row] = await this.database
      .update(goLiveChecklistItems)
      .set(
        input.status === "unknown"
          ? {
              status: input.status,
              evidence: {},
              reviewedBy: null,
              reviewedAt: null,
              updatedAt: now
            }
          : {
              status: input.status,
              evidence: input.evidence,
              reviewedBy: input.actorId,
              reviewedAt: now,
              updatedAt: now
            }
      )
      .where(eq(goLiveChecklistItems.key, input.key))
      .returning({
        key: goLiveChecklistItems.key,
        category: goLiveChecklistItems.category,
        label: goLiveChecklistItems.label,
        status: goLiveChecklistItems.status,
        evidence: goLiveChecklistItems.evidence,
        reviewedBy: goLiveChecklistItems.reviewedBy,
        reviewedAt: goLiveChecklistItems.reviewedAt
      });
    if (row === undefined) {
      throw new ReadinessStateError(`Checklist item "${input.key}" does not exist.`);
    }
    return row;
  }

  public async ensureSimulationPilotPlan(actorId: string, now = new Date()): Promise<PilotRunView> {
    const [existing] = await this.database
      .select()
      .from(pilotRuns)
      .where(inArray(pilotRuns.status, ["planned", "running"]))
      .orderBy(desc(pilotRuns.createdAt))
      .limit(1);
    if (existing !== undefined) {
      return existing;
    }

    const [row] = await this.database
      .insert(pilotRuns)
      .values({
        name: "Controlled 50-lead pilot",
        mode: "simulation",
        status: "planned",
        targetLeads: 50,
        allowedRegions: ["US", "UK"],
        dailyEmailCap: 10,
        reviewInterval: 20,
        humanApprovalRequired: true,
        startsAt: now,
        endsAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1_000),
        externalAuthorized: false,
        createdBy: actorId
      })
      .returning();
    if (row === undefined) {
      throw new ReadinessStateError("The simulation pilot plan could not be created.");
    }
    return row;
  }

  public async latestPilot(): Promise<PilotRunView | null> {
    const [row] = await this.database
      .select()
      .from(pilotRuns)
      .orderBy(desc(pilotRuns.createdAt))
      .limit(1);
    return row ?? null;
  }

  public async addPilotCheckpoint(input: {
    readonly pilotRunId: string;
    readonly afterMessageCount: number;
    readonly metrics: Record<string, unknown>;
    readonly decision: "continue" | "pause" | "abort";
    readonly notes: string;
    readonly actorId: string;
  }): Promise<void> {
    const [pilot] = await this.database
      .select({ id: pilotRuns.id, status: pilotRuns.status })
      .from(pilotRuns)
      .where(
        and(eq(pilotRuns.id, input.pilotRunId), inArray(pilotRuns.status, ["running", "completed"]))
      )
      .limit(1);
    if (pilot === undefined) {
      throw new ReadinessStateError("A checkpoint requires a running or completed pilot.");
    }
    await this.database.insert(pilotReviewCheckpoints).values({
      pilotRunId: input.pilotRunId,
      afterMessageCount: input.afterMessageCount,
      metrics: input.metrics,
      decision: input.decision,
      notes: input.notes,
      reviewedBy: input.actorId
    });
  }

  public async snapshot(): Promise<ReadinessSnapshot> {
    const [latestEval, checklist, pilot] = await Promise.all([
      this.latestEval(),
      this.listChecklist(),
      this.latestPilot()
    ]);
    return {
      latestEval,
      checklist,
      pilot,
      checklistPassed: checklist.filter((item) => item.status === "passed").length,
      checklistTotal: checklist.length,
      productionUnlocked: false
    };
  }
}
