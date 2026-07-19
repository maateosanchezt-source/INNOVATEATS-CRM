import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  handoffPacketSchema,
  leadStatusSchema,
  replyClassificationSchema,
  replyPriority,
  replyRequiresMateoNotification,
  type HandoffPacket,
  type InboundMessage,
  type LeadStatus,
  type ReplyClassification,
  type ReplyClassificationName,
  type SequenceStopReason
} from "@innovateats/shared";

import type { AppDatabase } from "../client.js";
import {
  auditLog,
  contacts,
  evidence,
  founders,
  gmailSyncCursors,
  handoffs,
  inboundMessages,
  internalNotifications,
  leads,
  leadStatusHistory,
  messageDrafts,
  organizations,
  outboundMessages,
  outboxEvents,
  recheckTasks,
  replyClassificationsTable,
  senders,
  sequences,
  strategyBriefs,
  suppressionList
} from "../schema/index.js";

export interface KnownGmailThread {
  readonly threadId: string;
  readonly sequenceId: string;
}

export interface ReplyHandoffContext {
  readonly sequenceId: string;
  readonly workflowId: string;
  readonly leadId: string;
  readonly senderId: string;
  readonly expectedFromAddress: string;
  readonly brandName: string;
  readonly founderNames: readonly string[];
  readonly product: string | null;
  readonly stage: string;
  readonly discoverySignal: string | null;
  readonly opportunity: string | null;
  readonly messageHistory: readonly string[];
  readonly evidence: readonly {
    readonly claim: string;
    readonly sourceUrl: string;
  }[];
}

export interface IngestedReplyResult {
  readonly status: "created" | "duplicate" | "ignored";
  readonly inboundMessageId?: string;
  readonly handoffId?: string;
}

export interface ReplyListItem {
  readonly id: string;
  readonly leadId: string;
  readonly brandName: string;
  readonly fromAddress: string;
  readonly subject: string;
  readonly bodyText: string;
  readonly receivedAt: Date;
  readonly classification: ReplyClassificationName;
  readonly confidence: number;
  readonly priority: number;
  readonly suppressionRequired: boolean;
  readonly followUpDate: string | null;
  readonly handoffId: string;
  readonly handoffStatus: "ready" | "owned";
}

export interface ReplyDetail extends ReplyListItem {
  readonly packet: HandoffPacket;
  readonly evidenceSnippets: readonly string[];
}

export class InboundStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InboundStateError";
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isProviderBounceAddress(address: string, contactAddress: string): boolean {
  const [localPart, domain] = address.trim().toLowerCase().split("@");
  const contactDomain = contactAddress.trim().toLowerCase().split("@")[1];
  return (
    (localPart === "mailer-daemon" || localPart === "postmaster") &&
    (domain === "googlemail.com" || domain === "gmail.com" || domain === contactDomain)
  );
}

function stopReasonFor(classification: ReplyClassificationName): SequenceStopReason {
  if (classification === "bounce") {
    return "bounce";
  }
  if (classification === "unsubscribe" || classification === "complaint") {
    return "unsubscribe";
  }
  return "human_reply";
}

function followUpAt(date: string): Date {
  return new Date(`${date}T09:00:00.000Z`);
}

export class PostgresInboundRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async getCursor(senderId: string): Promise<string | null> {
    const [row] = await this.database
      .select({ historyId: gmailSyncCursors.historyId })
      .from(gmailSyncCursors)
      .where(eq(gmailSyncCursors.senderId, senderId))
      .limit(1);
    return row?.historyId ?? null;
  }

  public async advanceCursor(senderId: string, historyId: string): Promise<void> {
    await this.database
      .insert(gmailSyncCursors)
      .values({ senderId, historyId })
      .onConflictDoUpdate({
        target: gmailSyncCursors.senderId,
        set: { historyId, updatedAt: new Date() }
      });
  }

  public async listKnownThreads(senderId: string): Promise<readonly KnownGmailThread[]> {
    const rows = await this.database
      .select({
        threadId: outboundMessages.threadId,
        sequenceId: sequences.id
      })
      .from(outboundMessages)
      .innerJoin(sequences, eq(sequences.id, outboundMessages.sequenceId))
      .where(
        and(
          eq(sequences.senderId, senderId),
          eq(outboundMessages.deliveryStatus, "sent"),
          sql`${outboundMessages.threadId} IS NOT NULL`
        )
      );
    const unique = new Map<string, KnownGmailThread>();
    for (const row of rows) {
      if (row.threadId !== null) {
        unique.set(row.threadId, { threadId: row.threadId, sequenceId: row.sequenceId });
      }
    }
    return [...unique.values()];
  }

  public async getHandoffContext(
    senderId: string,
    threadId: string,
    fromAddress: string,
    allowProviderBounce = false
  ): Promise<ReplyHandoffContext | null> {
    const normalizedFrom = fromAddress.trim().toLowerCase();
    const [row] = await this.database
      .select({
        sequenceId: sequences.id,
        workflowId: sequences.workflowId,
        leadId: sequences.leadId,
        senderId: sequences.senderId,
        expectedFromAddress: contacts.normalizedValue,
        brandName: organizations.displayName,
        product: organizations.productSummary,
        stage: organizations.stage,
        discoverySignal: leads.discoverySignal
      })
      .from(sequences)
      .innerJoin(contacts, eq(contacts.id, sequences.contactId))
      .innerJoin(leads, eq(leads.id, sequences.leadId))
      .innerJoin(organizations, eq(organizations.id, leads.organizationId))
      .innerJoin(outboundMessages, eq(outboundMessages.sequenceId, sequences.id))
      .where(
        and(
          eq(sequences.senderId, senderId),
          eq(outboundMessages.threadId, threadId),
          eq(outboundMessages.deliveryStatus, "sent")
        )
      )
      .orderBy(desc(outboundMessages.sentAt))
      .limit(1);
    if (row === undefined) {
      return null;
    }
    if (
      row.expectedFromAddress !== normalizedFrom &&
      !(allowProviderBounce && isProviderBounceAddress(normalizedFrom, row.expectedFromAddress))
    ) {
      return null;
    }
    const [founderRows, evidenceRows, draftRows] = await Promise.all([
      this.database
        .select({ name: founders.name })
        .from(founders)
        .innerJoin(organizations, eq(organizations.id, founders.organizationId))
        .innerJoin(leads, eq(leads.organizationId, organizations.id))
        .where(eq(leads.id, row.leadId))
        .orderBy(founders.name),
      this.database
        .select({ claim: evidence.claim, sourceUrl: evidence.sourceUrl })
        .from(evidence)
        .where(and(eq(evidence.leadId, row.leadId), eq(evidence.state, "active")))
        .orderBy(desc(evidence.createdAt))
        .limit(20),
      this.database
        .select({ body: messageDrafts.body })
        .from(outboundMessages)
        .innerJoin(messageDrafts, eq(messageDrafts.id, outboundMessages.messageDraftId))
        .where(
          and(
            eq(outboundMessages.sequenceId, row.sequenceId),
            inArray(outboundMessages.deliveryStatus, ["sent", "dry_run"])
          )
        )
        .orderBy(asc(outboundMessages.sequenceStep))
    ]);
    const [opportunityRow] = await this.database
      .select({ opportunity: strategyBriefs.opportunity })
      .from(messageDrafts)
      .innerJoin(strategyBriefs, eq(strategyBriefs.id, messageDrafts.strategyBriefId))
      .innerJoin(outboundMessages, eq(outboundMessages.messageDraftId, messageDrafts.id))
      .where(eq(outboundMessages.sequenceId, row.sequenceId))
      .limit(1);
    return {
      ...row,
      founderNames: founderRows.map((founder) => founder.name),
      opportunity: opportunityRow?.opportunity ?? null,
      messageHistory: draftRows.map((draft) => draft.body),
      evidence: evidenceRows
    };
  }

  public async ingestReply(
    message: InboundMessage,
    classificationInput: ReplyClassification,
    packetInput: HandoffPacket,
    authorizedEmail: string
  ): Promise<IngestedReplyResult> {
    const classification = replyClassificationSchema.parse(classificationInput);
    const packet = handoffPacketSchema.parse(packetInput);
    const normalizedFrom = message.fromAddress.trim().toLowerCase();
    const normalizedTo = message.toAddress.trim().toLowerCase();
    const now = new Date();

    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ id: inboundMessages.id })
        .from(inboundMessages)
        .where(eq(inboundMessages.providerMessageId, message.providerMessageId))
        .limit(1);
      if (existing !== undefined) {
        const [existingHandoff] = await transaction
          .select({ id: handoffs.id })
          .from(handoffs)
          .where(eq(handoffs.replyId, existing.id))
          .orderBy(desc(handoffs.version))
          .limit(1);
        return {
          status: "duplicate",
          inboundMessageId: existing.id,
          ...(existingHandoff === undefined ? {} : { handoffId: existingHandoff.id })
        };
      }

      const [match] = await transaction
        .select({
          sequence: sequences,
          contactAddress: contacts.normalizedValue,
          leadStatus: leads.status
        })
        .from(sequences)
        .innerJoin(contacts, eq(contacts.id, sequences.contactId))
        .innerJoin(leads, eq(leads.id, sequences.leadId))
        .innerJoin(senders, eq(senders.id, sequences.senderId))
        .innerJoin(outboundMessages, eq(outboundMessages.sequenceId, sequences.id))
        .where(
          and(
            eq(senders.email, normalizedTo),
            eq(outboundMessages.threadId, message.threadId),
            eq(outboundMessages.deliveryStatus, "sent")
          )
        )
        .orderBy(desc(outboundMessages.sentAt))
        .limit(1)
        .for("update", { of: sequences });
      if (match === undefined) {
        return { status: "ignored" };
      }
      const providerBounce =
        classification.classification === "bounce" &&
        isProviderBounceAddress(normalizedFrom, match.contactAddress);
      if (match.contactAddress !== normalizedFrom && !providerBounce) {
        return { status: "ignored" };
      }

      const [created] = await transaction
        .insert(inboundMessages)
        .values({
          providerMessageId: message.providerMessageId,
          threadId: message.threadId,
          senderId: match.sequence.senderId,
          sequenceId: match.sequence.id,
          leadId: match.sequence.leadId,
          associationType: providerBounce ? "provider_bounce" : "contact_reply",
          fromAddress: normalizedFrom,
          toAddress: normalizedTo,
          subject: message.subject,
          bodyText: message.bodyText.slice(0, 50_000),
          bodyHash: hash(message.bodyText.slice(0, 50_000)),
          receivedAt: new Date(message.receivedAt),
          providerHeaders: message.headers
        })
        .returning({ id: inboundMessages.id });
      if (created === undefined) {
        throw new InboundStateError("Inbound insert returned no record.");
      }
      await transaction.insert(replyClassificationsTable).values({
        inboundMessageId: created.id,
        version: 1,
        classifierVersion: "deterministic-reply-v1",
        classification: classification.classification,
        confidence: classification.confidence,
        sentiment: classification.sentiment,
        requestedAction: classification.requestedAction,
        suppressionRequired: classification.suppressionRequired,
        followUpDate: classification.followUpDate,
        evidenceSnippets: classification.evidenceSnippets,
        createdBy: "reply-classifier"
      });

      const stopReason = stopReasonFor(classification.classification);
      if (!["stopped", "completed", "start_failed"].includes(match.sequence.status)) {
        await transaction
          .update(sequences)
          .set({
            status: "stopped",
            stoppedAt: now,
            stopReason,
            updatedAt: now
          })
          .where(eq(sequences.id, match.sequence.id));
      }
      await transaction
        .update(outboundMessages)
        .set({ deliveryStatus: "cancelled", error: stopReason, updatedAt: now })
        .where(
          and(
            eq(outboundMessages.sequenceId, match.sequence.id),
            eq(outboundMessages.deliveryStatus, "scheduled")
          )
        );
      if (classification.classification === "bounce") {
        await transaction
          .update(outboundMessages)
          .set({ bounceType: "unknown", updatedAt: now })
          .where(
            and(
              eq(outboundMessages.sequenceId, match.sequence.id),
              eq(outboundMessages.deliveryStatus, "sent")
            )
          );
      }

      if (classification.suppressionRequired) {
        await transaction
          .insert(suppressionList)
          .values({
            normalizedContact: match.contactAddress,
            contactHash: hash(match.contactAddress),
            channel: "email",
            reason: classification.classification,
            source: `inbound:${created.id}`,
            createdBy: "reply-ingestion"
          })
          .onConflictDoNothing({
            target: [suppressionList.normalizedContact, suppressionList.channel]
          });
      }

      let currentLeadStatus: LeadStatus = leadStatusSchema.parse(match.leadStatus);
      const transition = async (toStatus: LeadStatus, reason: string): Promise<void> => {
        if (currentLeadStatus === toStatus) {
          return;
        }
        await transaction
          .update(leads)
          .set({ status: toStatus, nextActionAt: null, updatedAt: now })
          .where(eq(leads.id, match.sequence.leadId));
        await transaction.insert(leadStatusHistory).values({
          leadId: match.sequence.leadId,
          fromStatus: currentLeadStatus,
          toStatus,
          reason,
          actorId: "reply-ingestion"
        });
        currentLeadStatus = toStatus;
      };
      if (classification.suppressionRequired) {
        await transition("suppressed", `Inbound ${classification.classification}.`);
      } else {
        if (
          ["scheduled", "contacted", "follow_up_wait", "no_response_nurture"].includes(
            currentLeadStatus
          )
        ) {
          await transition("responded", `Inbound ${classification.classification}.`);
        }
        if (
          currentLeadStatus === "responded" &&
          replyRequiresMateoNotification(classification.classification)
        ) {
          await transition("handoff_ready", "Reply requires Mateo handoff.");
        }
      }

      const [handoff] = await transaction
        .insert(handoffs)
        .values({
          leadId: match.sequence.leadId,
          replyId: created.id,
          version: 1,
          packet,
          createdBy: "handoff-agent"
        })
        .returning({ id: handoffs.id });
      if (handoff === undefined) {
        throw new InboundStateError("Handoff insert returned no record.");
      }
      if (replyRequiresMateoNotification(classification.classification)) {
        await transaction.insert(internalNotifications).values({
          type: "reply_needs_mateo",
          handoffId: handoff.id,
          recipient: authorizedEmail.trim().toLowerCase(),
          title: `${classification.classification.replaceAll("_", " ")} reply`,
          body: packet.executiveSummary
        });
      }
      if (classification.followUpDate !== null) {
        await transaction.insert(recheckTasks).values({
          leadId: match.sequence.leadId,
          inboundMessageId: created.id,
          reason: classification.classification,
          scheduledAt: followUpAt(classification.followUpDate)
        });
      }
      await transaction.insert(outboxEvents).values({
        eventType: "sequence.stop",
        aggregateType: "sequence",
        aggregateId: match.sequence.id,
        idempotencyKey: `sequence.stop:${created.id}`,
        payload: {
          sequenceId: match.sequence.id,
          workflowId: match.sequence.workflowId,
          reason: stopReason
        }
      });
      await transaction.insert(auditLog).values({
        actorType: "system",
        actorId: "reply-ingestion",
        action: "reply.ingested",
        entityType: "inbound_message",
        entityId: created.id,
        after: {
          sequenceId: match.sequence.id,
          classification: classification.classification,
          suppressionRequired: classification.suppressionRequired,
          handoffId: handoff.id
        }
      });
      return { status: "created", inboundMessageId: created.id, handoffId: handoff.id };
    });
  }

  public async listReplies(): Promise<readonly ReplyListItem[]> {
    const rows = await this.database
      .select({
        inbound: inboundMessages,
        brandName: organizations.displayName,
        classification: replyClassificationsTable,
        handoffId: handoffs.id,
        handoffStatus: handoffs.status
      })
      .from(inboundMessages)
      .innerJoin(leads, eq(leads.id, inboundMessages.leadId))
      .innerJoin(organizations, eq(organizations.id, leads.organizationId))
      .innerJoin(
        replyClassificationsTable,
        eq(replyClassificationsTable.inboundMessageId, inboundMessages.id)
      )
      .innerJoin(handoffs, eq(handoffs.replyId, inboundMessages.id))
      .where(eq(replyClassificationsTable.version, 1))
      .orderBy(desc(inboundMessages.receivedAt));
    return rows
      .map((row) => ({
        id: row.inbound.id,
        leadId: row.inbound.leadId,
        brandName: row.brandName,
        fromAddress: row.inbound.fromAddress,
        subject: row.inbound.subject,
        bodyText: row.inbound.bodyText,
        receivedAt: row.inbound.receivedAt,
        classification: row.classification.classification,
        confidence: row.classification.confidence,
        priority: replyPriority[row.classification.classification],
        suppressionRequired: row.classification.suppressionRequired,
        followUpDate: row.classification.followUpDate,
        handoffId: row.handoffId,
        handoffStatus: row.handoffStatus
      }))
      .sort(
        (left, right) =>
          left.priority - right.priority || right.receivedAt.getTime() - left.receivedAt.getTime()
      );
  }

  public async getReply(id: string): Promise<ReplyDetail | null> {
    const list = await this.listReplies();
    const item = list.find((candidate) => candidate.id === id);
    if (item === undefined) {
      return null;
    }
    const [row] = await this.database
      .select({
        packet: handoffs.packet,
        evidenceSnippets: replyClassificationsTable.evidenceSnippets
      })
      .from(handoffs)
      .innerJoin(
        replyClassificationsTable,
        eq(replyClassificationsTable.inboundMessageId, handoffs.replyId)
      )
      .where(and(eq(handoffs.replyId, id), eq(replyClassificationsTable.version, 1)))
      .limit(1);
    return row === undefined
      ? null
      : {
          ...item,
          packet: handoffPacketSchema.parse(row.packet),
          evidenceSnippets: row.evidenceSnippets
        };
  }

  public async listRepliesForLead(leadId: string): Promise<readonly ReplyListItem[]> {
    return (await this.listReplies()).filter((reply) => reply.leadId === leadId);
  }

  public async markOwned(replyId: string, actorId: string, now = new Date()): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          handoffId: handoffs.id,
          status: handoffs.status,
          leadId: handoffs.leadId,
          leadStatus: leads.status
        })
        .from(handoffs)
        .innerJoin(leads, eq(leads.id, handoffs.leadId))
        .where(eq(handoffs.replyId, replyId))
        .orderBy(desc(handoffs.version))
        .limit(1)
        .for("update", { of: handoffs });
      if (row === undefined) {
        throw new InboundStateError("Reply handoff was not found.");
      }
      if (row.status === "owned") {
        return;
      }
      if (row.leadStatus !== "handoff_ready" && row.leadStatus !== "mateo_owned") {
        throw new InboundStateError("Only a handoff-ready lead can become Mateo-owned.");
      }
      await transaction
        .update(handoffs)
        .set({ status: "owned", ownedBy: actorId, ownedAt: now, updatedAt: now })
        .where(eq(handoffs.id, row.handoffId));
      if (row.leadStatus === "handoff_ready") {
        await transaction
          .update(leads)
          .set({ status: "mateo_owned", updatedAt: now })
          .where(eq(leads.id, row.leadId));
        await transaction.insert(leadStatusHistory).values({
          leadId: row.leadId,
          fromStatus: row.leadStatus,
          toStatus: "mateo_owned",
          reason: "Mateo accepted the reply handoff.",
          actorId
        });
      }
      await transaction
        .update(internalNotifications)
        .set({ readAt: now })
        .where(
          and(
            eq(internalNotifications.handoffId, row.handoffId),
            isNull(internalNotifications.readAt)
          )
        );
      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: "handoff.marked_owned",
        entityType: "handoff",
        entityId: row.handoffId,
        after: { leadId: row.leadId, replyId }
      });
    });
  }

  public async countUnreadNotifications(recipient: string): Promise<number> {
    const [row] = await this.database
      .select({ count: sql<number>`count(*)::int` })
      .from(internalNotifications)
      .where(
        and(
          eq(internalNotifications.recipient, recipient.trim().toLowerCase()),
          isNull(internalNotifications.readAt)
        )
      );
    return row?.count ?? 0;
  }
}
