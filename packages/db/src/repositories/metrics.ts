import { and, eq, gte, sql } from "drizzle-orm";

import type { AppDatabase } from "../client.js";
import {
  agentRuns,
  contacts,
  inboundMessages,
  leads,
  messageApprovals,
  messageDrafts,
  messageQualityReviews,
  outboundMessages,
  replyClassificationsTable,
  sequences,
  suppressionList
} from "../schema/index.js";

export interface FunnelMetrics {
  readonly totalLeads: number;
  readonly strongLeads: number;
  readonly byStatus: Readonly<Record<string, number>>;
}

export interface QualityMetrics {
  readonly totalDrafts: number;
  readonly approvedDrafts: number;
  readonly approvedQaPassed: number;
  readonly factualSpans: number;
  readonly evidenceMappedSpans: number;
  readonly evidenceMappingCoverage: number | null;
  readonly humanReviews: number;
  readonly averageHumanScore: number | null;
}

export interface DeliverabilityMetrics {
  readonly sent: number;
  readonly bounced: number;
  readonly bounceRate: number | null;
  readonly spamComplaints: number;
  readonly suppressionViolations: number;
  readonly observedReplyStops: number;
  readonly worstReplyCancellationMilliseconds: number | null;
}

export interface CostMetrics {
  readonly tokensInToday: number;
  readonly tokensOutToday: number;
  readonly costUsdToday: number;
  readonly costUsdMonth: number;
  readonly qualifiedLeads: number;
  readonly costPerQualifiedLeadUsd: number | null;
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export class PostgresMetricsRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async funnel(): Promise<FunnelMetrics> {
    const rows = await this.database
      .select({
        status: leads.status,
        count: sql<number>`count(*)::int`
      })
      .from(leads)
      .groupBy(leads.status);
    const byStatus = Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
    const totalLeads = rows.reduce((sum, row) => sum + Number(row.count), 0);
    const [strong] = await this.database
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(gte(leads.icpScore, 85), eq(leads.hardExclusion, false)));
    return {
      totalLeads,
      strongLeads: Number(strong?.count ?? 0),
      byStatus
    };
  }

  public async quality(): Promise<QualityMetrics> {
    const [draftRows, approvalRows, reviewRows] = await Promise.all([
      this.database
        .select({
          id: messageDrafts.id,
          evidenceMap: messageDrafts.evidenceMap
        })
        .from(messageDrafts),
      this.database
        .select({
          qaPassed: messageDrafts.qaPassed
        })
        .from(messageApprovals)
        .innerJoin(messageDrafts, eq(messageDrafts.id, messageApprovals.messageDraftId))
        .where(eq(messageApprovals.decision, "approved")),
      this.database
        .select({ averageScore: messageQualityReviews.averageScore })
        .from(messageQualityReviews)
    ]);
    const factualSpans = draftRows.flatMap((draft) =>
      draft.evidenceMap.filter((span) => span.kind === "fact")
    );
    const evidenceMappedSpans = factualSpans.filter((span) => span.evidenceIds.length > 0);
    const reviewScores = reviewRows.map((row) => Number(row.averageScore));
    return {
      totalDrafts: draftRows.length,
      approvedDrafts: approvalRows.length,
      approvedQaPassed: approvalRows.filter((row) => row.qaPassed).length,
      factualSpans: factualSpans.length,
      evidenceMappedSpans: evidenceMappedSpans.length,
      evidenceMappingCoverage:
        factualSpans.length === 0 ? null : evidenceMappedSpans.length / factualSpans.length,
      humanReviews: reviewScores.length,
      averageHumanScore:
        reviewScores.length === 0
          ? null
          : rounded(reviewScores.reduce((sum, score) => sum + score, 0) / reviewScores.length)
    };
  }

  public async deliverability(): Promise<DeliverabilityMetrics> {
    const [outbounds, complaints, replyStops, suppressionRows] = await Promise.all([
      this.database
        .select({
          bounceType: outboundMessages.bounceType
        })
        .from(outboundMessages)
        .where(sql`${outboundMessages.sentAt} IS NOT NULL`),
      this.database
        .select({ count: sql<number>`count(*)::int` })
        .from(replyClassificationsTable)
        .where(eq(replyClassificationsTable.classification, "complaint")),
      this.database
        .select({
          receivedAt: inboundMessages.receivedAt,
          stoppedAt: sequences.stoppedAt
        })
        .from(inboundMessages)
        .innerJoin(sequences, eq(sequences.id, inboundMessages.sequenceId))
        .where(sql`${sequences.stoppedAt} IS NOT NULL`),
      this.database
        .select({ count: sql<number>`count(*)::int` })
        .from(outboundMessages)
        .innerJoin(sequences, eq(sequences.id, outboundMessages.sequenceId))
        .innerJoin(contacts, eq(contacts.id, sequences.contactId))
        .innerJoin(suppressionList, eq(suppressionList.normalizedContact, contacts.normalizedValue))
        .where(
          and(
            eq(outboundMessages.deliveryStatus, "sent"),
            sql`${suppressionList.createdAt} <= ${outboundMessages.sentAt}`
          )
        )
    ]);
    const bounced = outbounds.filter((row) => row.bounceType !== null).length;
    const sent = outbounds.length - bounced;
    const replyLatencies = replyStops.flatMap((row) =>
      row.stoppedAt === null
        ? []
        : [Math.max(0, row.stoppedAt.getTime() - row.receivedAt.getTime())]
    );
    return {
      sent,
      bounced,
      bounceRate: sent + bounced === 0 ? null : bounced / (sent + bounced),
      spamComplaints: Number(complaints[0]?.count ?? 0),
      suppressionViolations: Number(suppressionRows[0]?.count ?? 0),
      observedReplyStops: replyLatencies.length,
      worstReplyCancellationMilliseconds:
        replyLatencies.length === 0 ? null : Math.max(...replyLatencies)
    };
  }

  public async costs(now = new Date()): Promise<CostMetrics> {
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [todayRows, monthRows, qualified] = await Promise.all([
      this.database
        .select({
          tokensIn: agentRuns.tokensIn,
          tokensOut: agentRuns.tokensOut,
          costUsd: agentRuns.costUsd
        })
        .from(agentRuns)
        .where(gte(agentRuns.createdAt, startOfDay)),
      this.database
        .select({ costUsd: agentRuns.costUsd })
        .from(agentRuns)
        .where(gte(agentRuns.createdAt, startOfMonth)),
      this.database
        .select({ count: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(gte(leads.icpScore, 85), eq(leads.hardExclusion, false)))
    ]);
    const costUsdToday = todayRows.reduce((sum, row) => sum + Number(row.costUsd), 0);
    const costUsdMonth = monthRows.reduce((sum, row) => sum + Number(row.costUsd), 0);
    const qualifiedLeads = Number(qualified[0]?.count ?? 0);
    return {
      tokensInToday: todayRows.reduce((sum, row) => sum + row.tokensIn, 0),
      tokensOutToday: todayRows.reduce((sum, row) => sum + row.tokensOut, 0),
      costUsdToday: rounded(costUsdToday),
      costUsdMonth: rounded(costUsdMonth),
      qualifiedLeads,
      costPerQualifiedLeadUsd: qualifiedLeads === 0 ? null : rounded(costUsdMonth / qualifiedLeads)
    };
  }
}
