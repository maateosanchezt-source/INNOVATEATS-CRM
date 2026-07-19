import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";

import {
  complianceDecisionResultSchema,
  INNOVATEATS_WEBSITE,
  nextPreferredSendWindow,
  outboundIdempotencyKey,
  outboundDeliveryStatusSchema,
  outreachSequenceStatusSchema,
  sequenceWorkflowId,
  type ComplianceDecisionResult,
  type GmailDeliveryMode,
  type OutboundDeliveryStatus,
  type OutreachSequenceStatus,
  type PrepareTouchResult,
  type SequenceStopReason
} from "@innovateats/shared";

import type { AppDatabase } from "../client.js";
import {
  auditLog,
  campaigns,
  complianceDecisions,
  contacts,
  featureFlags,
  gmailCredentials,
  killSwitches,
  leads,
  leadStatusHistory,
  messageApprovals,
  messageDrafts,
  organizations,
  outboundMessages,
  outboxEvents,
  regionPolicyVersions,
  regions,
  sendAttempts,
  senders,
  sequences,
  suppressionList
} from "../schema/index.js";

export interface CreateSequenceInput {
  readonly leadId: string;
  readonly contactId: string;
  readonly campaignId: string;
  readonly senderId: string;
  readonly recipientTimezone: string;
  readonly deliveryMode: GmailDeliveryMode;
  readonly complianceDecisionId: string;
  readonly actorId: string;
  readonly now?: Date;
}

export interface CreatedSequence {
  readonly id: string;
  readonly workflowId: string;
  readonly status: OutreachSequenceStatus;
  readonly deliveryMode: GmailDeliveryMode;
  readonly scheduledTouches: readonly {
    readonly outboundMessageId: string;
    readonly sequenceStep: 1 | 2 | 3;
    readonly scheduledAt: Date;
  }[];
}

export interface SequenceWorkspace {
  readonly campaigns: readonly {
    readonly id: string;
    readonly name: string;
    readonly active: boolean;
    readonly dailyCap: number;
  }[];
  readonly senders: readonly {
    readonly id: string;
    readonly email: string;
    readonly active: boolean;
    readonly connected: boolean;
  }[];
  readonly sequences: readonly {
    readonly id: string;
    readonly workflowId: string;
    readonly status: OutreachSequenceStatus;
    readonly deliveryMode: GmailDeliveryMode;
    readonly recipientTimezone: string;
    readonly currentStep: number;
    readonly stopReason: string | null;
    readonly outbounds: readonly {
      readonly id: string;
      readonly sequenceStep: number;
      readonly scheduledAt: Date;
      readonly sentAt: Date | null;
      readonly deliveryStatus: OutboundDeliveryStatus;
      readonly error: string | null;
    }[];
  }[];
}

export interface OutboxEventRecord {
  readonly id: string;
  readonly eventType: "sequence.start" | "sequence.stop";
  readonly sequenceId: string;
  readonly workflowId: string;
  readonly reason: SequenceStopReason | null;
}

export interface RuntimeSendGate {
  readonly configuredMode: GmailDeliveryMode;
  readonly environmentDryRun: boolean;
  readonly environmentEmailSendEnabled: boolean;
  readonly productionSendApproved: boolean;
  readonly sandboxSendApproved: boolean;
  readonly authorizedEmail: string;
  readonly sandboxRecipient: string;
  readonly businessContactEmail: string;
  readonly businessPostalAddress: string | undefined;
  readonly globalDailyCap: number;
  readonly externalIntegrationConfigured: boolean;
}

export interface ClaimedOutbound {
  readonly outboundMessageId: string;
  readonly sequenceId: string;
  readonly senderId: string;
  readonly mode: GmailDeliveryMode;
  readonly senderEmail: string;
  readonly recipientEmail: string;
  readonly originalRecipientEmail: string;
  readonly subject: string;
  readonly body: string;
  readonly internetMessageId: string;
  readonly threadId: string | null;
  readonly inReplyTo: string | null;
  readonly references: readonly string[];
  readonly attemptNumber: number;
  readonly decisionTrace: Readonly<Record<string, unknown>>;
  readonly businessContactEmail: string;
  readonly physicalPostalAddress: string | null;
  readonly advertisementDisclosure: boolean;
}

export type ClaimOutboundResult =
  | { readonly outcome: "claimed"; readonly message: ClaimedOutbound }
  | { readonly outcome: "blocked"; readonly outboundMessageId: string; readonly reason: string };

export class OutreachStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OutreachStateError";
  }
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function scheduleForTouches(now: Date, timezone: string): readonly [Date, Date, Date] {
  const touchOne = nextPreferredSendWindow(now, timezone);
  const touchTwo = nextPreferredSendWindow(
    new Date(touchOne.getTime() + 4 * 24 * 60 * 60 * 1_000),
    timezone
  );
  const touchThree = nextPreferredSendWindow(
    new Date(touchOne.getTime() + 10 * 24 * 60 * 60 * 1_000),
    timezone
  );
  return [touchOne, touchTwo, touchThree];
}

function runtimeBlockReason(mode: GmailDeliveryMode, gate: RuntimeSendGate): string | null {
  if (gate.configuredMode !== mode) {
    return "Delivery mode changed after scheduling.";
  }
  if (mode === "dry_run") {
    return gate.environmentDryRun ? null : "Dry-run sequence requires GLOBAL_DRY_RUN=true.";
  }
  if (gate.environmentDryRun) {
    return "External delivery is blocked while GLOBAL_DRY_RUN=true.";
  }
  if (!gate.environmentEmailSendEnabled) {
    return "External delivery is blocked while EMAIL_SEND_ENABLED=false.";
  }
  if (!gate.externalIntegrationConfigured) {
    return "Gmail OAuth delivery integration is not fully configured.";
  }
  if (mode === "sandbox") {
    if (!gate.sandboxSendApproved) {
      return "Sandbox delivery has not been explicitly approved.";
    }
    if (normalizedEmail(gate.sandboxRecipient) !== normalizedEmail(gate.authorizedEmail)) {
      return "Sandbox recipient is not the authorized internal user.";
    }
    return null;
  }
  return gate.productionSendApproved
    ? null
    : "Production delivery has not received explicit go-live approval.";
}

export class PostgresOutreachRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async getWorkspace(leadId: string): Promise<SequenceWorkspace> {
    const [campaignRows, senderRows, sequenceRows] = await Promise.all([
      this.database.select().from(campaigns).orderBy(campaigns.name),
      this.database
        .select({
          id: senders.id,
          email: senders.email,
          active: senders.active,
          connected: sql<boolean>`EXISTS (
            SELECT 1 FROM gmail_credentials credential
            WHERE credential.sender_id = ${senders.id}
          )`
        })
        .from(senders)
        .orderBy(senders.email),
      this.database
        .select()
        .from(sequences)
        .where(eq(sequences.leadId, leadId))
        .orderBy(desc(sequences.createdAt))
    ]);
    const ids = sequenceRows.map((row) => row.id);
    const outboundRows =
      ids.length === 0
        ? []
        : await this.database
            .select()
            .from(outboundMessages)
            .where(inArray(outboundMessages.sequenceId, ids))
            .orderBy(asc(outboundMessages.sequenceStep));

    return {
      campaigns: campaignRows.map((row) => ({
        id: row.id,
        name: row.name,
        active: row.active,
        dailyCap: row.dailyCap
      })),
      senders: senderRows.map((row) => ({ ...row, connected: Boolean(row.connected) })),
      sequences: sequenceRows.map((row) => ({
        id: row.id,
        workflowId: row.workflowId,
        status: outreachSequenceStatusSchema.parse(row.status),
        deliveryMode: row.deliveryMode,
        recipientTimezone: row.recipientTimezone,
        currentStep: row.currentStep,
        stopReason: row.stopReason,
        outbounds: outboundRows
          .filter((outbound) => outbound.sequenceId === row.id)
          .map((outbound) => ({
            id: outbound.id,
            sequenceStep: outbound.sequenceStep,
            scheduledAt: outbound.scheduledAt,
            sentAt: outbound.sentAt,
            deliveryStatus: outboundDeliveryStatusSchema.parse(outbound.deliveryStatus),
            error: outbound.error
          }))
      }))
    };
  }

  public async createSequence(input: CreateSequenceInput): Promise<CreatedSequence> {
    const now = input.now ?? new Date();
    const scheduled = scheduleForTouches(now, input.recipientTimezone);
    const sequenceId = randomUUID();
    const workflowId = sequenceWorkflowId(sequenceId);

    return this.database.transaction(async (transaction) => {
      const latestDrafts = await transaction
        .select({
          id: messageDrafts.id,
          step: messageDrafts.sequenceStep,
          language: messageDrafts.language
        })
        .from(messageDrafts)
        .innerJoin(
          messageApprovals,
          and(
            eq(messageApprovals.messageDraftId, messageDrafts.id),
            eq(messageApprovals.decision, "approved")
          )
        )
        .where(
          and(
            eq(messageDrafts.leadId, input.leadId),
            eq(messageDrafts.contactId, input.contactId),
            eq(messageDrafts.qaPassed, true),
            isNull(
              sql`(
                SELECT newer.id
                FROM message_drafts newer
                WHERE newer.supersedes_id = ${messageDrafts.id}
                LIMIT 1
              )`
            )
          )
        )
        .orderBy(asc(messageDrafts.sequenceStep));
      if (
        latestDrafts.length !== 3 ||
        !latestDrafts.every((draft, index) => draft.step === index + 1)
      ) {
        throw new OutreachStateError("Three latest QA-passed and approved drafts are required.");
      }
      const [compliance] = await transaction
        .select({
          leadId: complianceDecisions.leadId,
          contactId: complianceDecisions.contactId,
          campaignId: complianceDecisions.campaignId,
          channel: complianceDecisions.channel,
          decision: complianceDecisions.decision,
          output: complianceDecisions.output
        })
        .from(complianceDecisions)
        .where(eq(complianceDecisions.id, input.complianceDecisionId))
        .limit(1);
      if (
        compliance === undefined ||
        compliance.leadId !== input.leadId ||
        compliance.contactId !== input.contactId ||
        compliance.campaignId !== input.campaignId ||
        compliance.channel !== "email"
      ) {
        throw new OutreachStateError("A matching email compliance decision is required.");
      }
      const complianceOutput = complianceDecisionResultSchema.parse(compliance.output);
      if (compliance.decision === "block") {
        throw new OutreachStateError(complianceOutput.reasons.join(" "));
      }
      if (
        input.deliveryMode !== "dry_run" &&
        !["allow", "approval_required"].includes(compliance.decision)
      ) {
        throw new OutreachStateError("The regional decision permits only an internal dry run.");
      }
      if (latestDrafts.some((draft) => draft.language !== complianceOutput.effectiveLanguage)) {
        throw new OutreachStateError(
          `Approved draft language must match policy language ${complianceOutput.effectiveLanguage}.`
        );
      }

      const [created] = await transaction
        .insert(sequences)
        .values({
          id: sequenceId,
          leadId: input.leadId,
          contactId: input.contactId,
          campaignId: input.campaignId,
          senderId: input.senderId,
          complianceDecisionId: input.complianceDecisionId,
          workflowId,
          recipientTimezone: input.recipientTimezone,
          deliveryMode: input.deliveryMode,
          createdBy: input.actorId
        })
        .returning({ id: sequences.id, status: sequences.status });
      if (created === undefined) {
        throw new OutreachStateError("Sequence insert returned no record.");
      }

      const touches = latestDrafts.map((draft, index) => {
        const step = (index + 1) as 1 | 2 | 3;
        const idempotencyKey = outboundIdempotencyKey(input.campaignId, input.leadId, step);
        return {
          id: randomUUID(),
          sequenceId,
          messageDraftId: draft.id,
          sequenceStep: step,
          internetMessageId: `<${idempotencyKey.replaceAll(":", "-")}@outreach.innovateats.com>`,
          idempotencyKey,
          scheduledAt: scheduled[index] as Date,
          decisionTrace: {
            scheduledBy: input.actorId,
            scheduledAt: now.toISOString(),
            deliveryMode: input.deliveryMode,
            complianceDecisionId: input.complianceDecisionId,
            requiredWebsite: INNOVATEATS_WEBSITE
          }
        };
      });
      await transaction.insert(outboundMessages).values(touches);
      await transaction.insert(outboxEvents).values({
        eventType: "sequence.start",
        aggregateType: "sequence",
        aggregateId: sequenceId,
        idempotencyKey: `sequence.start:${sequenceId}`,
        payload: { sequenceId, workflowId }
      });
      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId: input.actorId,
        action: "outreach.sequence_scheduled",
        entityType: "sequence",
        entityId: sequenceId,
        after: {
          campaignId: input.campaignId,
          senderId: input.senderId,
          deliveryMode: input.deliveryMode,
          complianceDecisionId: input.complianceDecisionId,
          scheduledAt: touches.map((touch) => touch.scheduledAt.toISOString())
        }
      });

      if (input.deliveryMode === "production") {
        const [lead] = await transaction
          .select({ status: leads.status })
          .from(leads)
          .where(eq(leads.id, input.leadId))
          .limit(1)
          .for("update");
        if (lead === undefined) {
          throw new OutreachStateError("Lead could not be locked.");
        }
        await transaction
          .update(leads)
          .set({ status: "scheduled", nextActionAt: touches[0]?.scheduledAt, updatedAt: now })
          .where(eq(leads.id, input.leadId));
        await transaction.insert(leadStatusHistory).values({
          leadId: input.leadId,
          fromStatus: lead.status,
          toStatus: "scheduled",
          reason: "Human-approved production outreach sequence scheduled.",
          actorId: input.actorId
        });
      }

      return {
        id: sequenceId,
        workflowId,
        status: outreachSequenceStatusSchema.parse(created.status),
        deliveryMode: input.deliveryMode,
        scheduledTouches: touches.map((touch) => ({
          outboundMessageId: touch.id,
          sequenceStep: touch.sequenceStep,
          scheduledAt: touch.scheduledAt
        }))
      };
    });
  }

  public async claimNextOutboxEvent(now = new Date()): Promise<OutboxEventRecord | null> {
    return this.database.transaction(async (transaction) => {
      const [event] = await transaction
        .select()
        .from(outboxEvents)
        .where(
          and(
            or(
              eq(outboxEvents.status, "pending"),
              eq(outboxEvents.status, "failed"),
              and(
                eq(outboxEvents.status, "processing"),
                lte(outboxEvents.updatedAt, new Date(now.getTime() - 5 * 60_000))
              )
            ),
            lte(outboxEvents.availableAt, now)
          )
        )
        .orderBy(asc(outboxEvents.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (event === undefined) {
        return null;
      }
      if (event.eventType !== "sequence.start" && event.eventType !== "sequence.stop") {
        throw new OutreachStateError("Outbox sequence event type is unsupported.");
      }
      const payload = event.payload as {
        sequenceId?: unknown;
        workflowId?: unknown;
        reason?: unknown;
      };
      if (typeof payload.sequenceId !== "string" || typeof payload.workflowId !== "string") {
        throw new OutreachStateError("Outbox sequence payload is malformed.");
      }
      const reason =
        event.eventType === "sequence.stop"
          ? (payload.reason as SequenceStopReason | undefined)
          : undefined;
      if (
        event.eventType === "sequence.stop" &&
        !["human_reply", "unsubscribe", "bounce"].includes(reason ?? "")
      ) {
        throw new OutreachStateError("Outbox sequence stop payload is malformed.");
      }
      await transaction
        .update(outboxEvents)
        .set({
          status: "processing",
          attemptCount: event.attemptCount + 1,
          lastError: null,
          updatedAt: now
        })
        .where(eq(outboxEvents.id, event.id));
      return {
        id: event.id,
        eventType: event.eventType,
        sequenceId: payload.sequenceId,
        workflowId: payload.workflowId,
        reason: reason ?? null
      };
    });
  }

  public async markOutboxProcessed(eventId: string, now = new Date()): Promise<void> {
    await this.database
      .update(outboxEvents)
      .set({ status: "processed", processedAt: now, lastError: null, updatedAt: now })
      .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.status, "processing")));
  }

  public async markOutboxFailed(eventId: string, error: string, now = new Date()): Promise<void> {
    await this.database
      .update(outboxEvents)
      .set({
        status: "failed",
        availableAt: new Date(now.getTime() + 60_000),
        lastError: error.slice(0, 1_000),
        updatedAt: now
      })
      .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.status, "processing")));
  }

  public async markWorkflowStarted(sequenceId: string, now = new Date()): Promise<void> {
    await this.database
      .update(sequences)
      .set({ status: "scheduled", startedAt: now, updatedAt: now })
      .where(and(eq(sequences.id, sequenceId), eq(sequences.status, "pending_workflow")));
  }

  public async markWorkflowStartFailed(
    sequenceId: string,
    reason: string,
    now = new Date()
  ): Promise<void> {
    await this.database
      .update(sequences)
      .set({
        status: "start_failed",
        stoppedAt: now,
        stopReason: reason.slice(0, 500),
        updatedAt: now
      })
      .where(eq(sequences.id, sequenceId));
  }

  public async prepareTouch(
    sequenceId: string,
    step: 1 | 2 | 3,
    now = new Date()
  ): Promise<PrepareTouchResult> {
    const [row] = await this.database
      .select({
        status: sequences.status,
        stoppedAt: sequences.stoppedAt,
        stopReason: sequences.stopReason,
        outboundId: outboundMessages.id,
        scheduledAt: outboundMessages.scheduledAt,
        deliveryStatus: outboundMessages.deliveryStatus
      })
      .from(sequences)
      .innerJoin(
        outboundMessages,
        and(eq(outboundMessages.sequenceId, sequences.id), eq(outboundMessages.sequenceStep, step))
      )
      .where(eq(sequences.id, sequenceId))
      .limit(1);
    if (row === undefined) {
      throw new OutreachStateError("Sequence touch was not found.");
    }
    if (row.status === "stopped" || row.status === "start_failed") {
      return {
        action: "stop",
        reason: (row.stopReason as SequenceStopReason | null) ?? "manual_cancel"
      };
    }
    if (row.status === "paused") {
      return {
        action: "wait",
        scheduledAt: new Date(now.getTime() + 60_000).toISOString()
      };
    }
    if (row.deliveryStatus === "sent" || row.deliveryStatus === "dry_run") {
      return { action: "send", outboundMessageId: row.outboundId };
    }
    if (row.deliveryStatus !== "scheduled") {
      return { action: "stop", reason: "policy_block" };
    }
    if (row.scheduledAt.getTime() > now.getTime()) {
      return { action: "wait", scheduledAt: row.scheduledAt.toISOString() };
    }
    return { action: "send", outboundMessageId: row.outboundId };
  }

  public async claimOutbound(
    sequenceId: string,
    outboundMessageId: string,
    gate: RuntimeSendGate,
    now = new Date()
  ): Promise<ClaimOutboundResult> {
    return this.database.transaction(async (transaction) => {
      const [sequenceLock] = await transaction
        .select({ id: sequences.id })
        .from(sequences)
        .where(eq(sequences.id, sequenceId))
        .limit(1)
        .for("update");
      if (sequenceLock === undefined) {
        throw new OutreachStateError("Outreach sequence was not found.");
      }
      const [row] = await transaction
        .select({
          sequence: sequences,
          outbound: outboundMessages,
          campaign: campaigns,
          sender: senders,
          contact: contacts,
          draft: messageDrafts,
          organizationDomain: organizations.canonicalDomain
        })
        .from(outboundMessages)
        .innerJoin(sequences, eq(sequences.id, outboundMessages.sequenceId))
        .innerJoin(campaigns, eq(campaigns.id, sequences.campaignId))
        .innerJoin(senders, eq(senders.id, sequences.senderId))
        .innerJoin(contacts, eq(contacts.id, sequences.contactId))
        .innerJoin(messageDrafts, eq(messageDrafts.id, outboundMessages.messageDraftId))
        .innerJoin(leads, eq(leads.id, sequences.leadId))
        .innerJoin(organizations, eq(organizations.id, leads.organizationId))
        .where(and(eq(sequences.id, sequenceId), eq(outboundMessages.id, outboundMessageId)))
        .limit(1)
        .for("update", { of: outboundMessages });
      if (row === undefined) {
        throw new OutreachStateError("Outbound message was not found.");
      }
      if (row.outbound.deliveryStatus !== "scheduled") {
        return {
          outcome: "blocked",
          outboundMessageId,
          reason: `Outbound is already ${row.outbound.deliveryStatus}; duplicate claim refused.`
        };
      }

      let reason = runtimeBlockReason(row.sequence.deliveryMode, gate);
      let complianceOutput: ComplianceDecisionResult | null = null;
      if (row.sequence.complianceDecisionId === null) {
        if (row.sequence.deliveryMode !== "dry_run") {
          reason = "External delivery requires an immutable compliance decision.";
        }
      } else {
        const [compliance] = await transaction
          .select({
            decision: complianceDecisions.decision,
            channel: complianceDecisions.channel,
            leadId: complianceDecisions.leadId,
            contactId: complianceDecisions.contactId,
            campaignId: complianceDecisions.campaignId,
            recordedVersion: complianceDecisions.regionPolicyVersion,
            output: complianceDecisions.output,
            policyVersion: regionPolicyVersions.version,
            policyStatus: regionPolicyVersions.status,
            regionEnabled: regions.enabled
          })
          .from(complianceDecisions)
          .innerJoin(
            regionPolicyVersions,
            eq(regionPolicyVersions.id, complianceDecisions.regionPolicyId)
          )
          .innerJoin(regions, eq(regions.id, regionPolicyVersions.regionId))
          .where(eq(complianceDecisions.id, row.sequence.complianceDecisionId))
          .limit(1);
        if (
          compliance === undefined ||
          compliance.channel !== "email" ||
          compliance.leadId !== row.sequence.leadId ||
          compliance.contactId !== row.sequence.contactId ||
          compliance.campaignId !== row.sequence.campaignId
        ) {
          reason = "Compliance decision is missing or does not match this sequence.";
        } else {
          complianceOutput = complianceDecisionResultSchema.parse(compliance.output);
          if (row.draft.language !== complianceOutput.effectiveLanguage) {
            reason = "Approved draft language no longer matches the compliance decision.";
          }
          if (
            row.sequence.deliveryMode !== "dry_run" &&
            (!["allow", "approval_required"].includes(compliance.decision) ||
              compliance.policyStatus !== "active" ||
              !compliance.regionEnabled ||
              compliance.recordedVersion !== compliance.policyVersion)
          ) {
            reason = "Compliance policy is stale, inactive, disabled, or not approved for sending.";
          }
        }
      }
      const flags = await transaction.select().from(featureFlags);
      const flagMap = new Map(flags.map((flag) => [flag.key, flag.enabled]));
      const activeSwitches = await transaction
        .select()
        .from(killSwitches)
        .where(eq(killSwitches.active, true));
      const switchBlocks = activeSwitches.some(
        (entry) =>
          entry.scopeType === "global" ||
          (entry.scopeType === "campaign" && entry.scopeId === row.sequence.campaignId) ||
          (entry.scopeType === "sender" && entry.scopeId === row.sequence.senderId)
      );
      if (reason === null && switchBlocks) {
        reason = "An active global, campaign, or sender kill switch blocks delivery.";
      }
      if (
        reason === null &&
        row.sequence.deliveryMode !== "dry_run" &&
        (flagMap.get("global_dry_run") !== false || flagMap.get("email_send_enabled") !== true)
      ) {
        reason = "Database feature flags do not authorize external email.";
      }
      if (
        reason === null &&
        row.sequence.deliveryMode === "dry_run" &&
        flagMap.get("global_dry_run") !== true
      ) {
        reason = "Database global dry-run flag is not active.";
      }
      if (
        reason === null &&
        (!row.campaign.active || row.campaign.approvalMode !== "approved_send")
      ) {
        reason = "Campaign is paused or no longer approved for sending.";
      }
      if (reason === null && row.sequence.deliveryMode !== "dry_run" && !row.sender.active) {
        reason = "Sender is inactive.";
      }
      if (reason === null && row.sequence.deliveryMode !== "dry_run") {
        const [credential] = await transaction
          .select({ id: gmailCredentials.id })
          .from(gmailCredentials)
          .where(eq(gmailCredentials.senderId, row.sequence.senderId))
          .orderBy(desc(gmailCredentials.version))
          .limit(1);
        if (credential === undefined) {
          reason = "Sender has no Gmail OAuth credential.";
        }
      }
      if (
        reason === null &&
        (row.contact.doNotContact ||
          row.contact.origin === "inferred_pattern" ||
          !["published_verified", "provider_verified"].includes(row.contact.verificationStatus))
      ) {
        reason = "Contact is no longer actionable.";
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
      if (reason === null && suppressed !== undefined) {
        reason = "Contact is suppressed.";
      }
      const [newerDraft] = await transaction
        .select({ id: messageDrafts.id })
        .from(messageDrafts)
        .where(eq(messageDrafts.supersedesId, row.draft.id))
        .limit(1);
      const [approval] = await transaction
        .select({ decision: messageApprovals.decision })
        .from(messageApprovals)
        .where(eq(messageApprovals.messageDraftId, row.draft.id))
        .limit(1);
      if (
        reason === null &&
        (newerDraft !== undefined || approval?.decision !== "approved" || !row.draft.qaPassed)
      ) {
        reason = "The scheduled draft is no longer the latest approved QA-passed version.";
      }
      if (reason === null && !row.draft.body.includes(INNOVATEATS_WEBSITE)) {
        reason = `Approved message is missing ${INNOVATEATS_WEBSITE}.`;
      }
      if (
        reason === null &&
        row.sequence.deliveryMode !== "dry_run" &&
        complianceOutput?.footerRequirements.includes("physical_postal_address") === true &&
        gate.businessPostalAddress === undefined
      ) {
        reason = "The active policy requires a configured physical postal address.";
      }
      if (reason === null && row.sequence.status === "paused") {
        reason = "Sequence is paused.";
      }
      if (reason === null && !["scheduled", "active"].includes(row.sequence.status)) {
        reason = `Sequence status ${row.sequence.status} is not sendable.`;
      }

      if (reason === null && row.sequence.deliveryMode !== "dry_run") {
        const since = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
        const [counts] = await transaction
          .select({
            campaign: sql<number>`count(*) FILTER (
              WHERE ${sequences.campaignId} = ${row.sequence.campaignId}
            )::int`,
            sender: sql<number>`count(*) FILTER (
              WHERE ${sequences.senderId} = ${row.sequence.senderId}
            )::int`,
            domain: sql<number>`count(*) FILTER (
              WHERE ${organizations.canonicalDomain} = ${row.organizationDomain}
            )::int`
          })
          .from(outboundMessages)
          .innerJoin(sequences, eq(sequences.id, outboundMessages.sequenceId))
          .innerJoin(leads, eq(leads.id, sequences.leadId))
          .innerJoin(organizations, eq(organizations.id, leads.organizationId))
          .where(
            and(
              eq(outboundMessages.deliveryStatus, "sent"),
              sql`${outboundMessages.sentAt} >= ${since}`
            )
          );
        const campaignCap = Math.min(row.campaign.dailyCap, gate.globalDailyCap);
        const senderCap = Math.min(row.sender.dailyCap, gate.globalDailyCap);
        if ((counts?.campaign ?? 0) >= campaignCap) {
          reason = "Campaign rolling 24-hour cap reached.";
        } else if ((counts?.sender ?? 0) >= senderCap) {
          reason = "Sender rolling 24-hour cap reached.";
        } else if ((counts?.domain ?? 0) >= row.campaign.dailyDomainCap) {
          reason = "Recipient-domain rolling 24-hour cap reached.";
        }
      }

      if (reason !== null) {
        await transaction
          .update(outboundMessages)
          .set({ deliveryStatus: "blocked", error: reason, updatedAt: now })
          .where(eq(outboundMessages.id, outboundMessageId));
        await transaction.insert(sendAttempts).values({
          outboundMessageId,
          idempotencyKey: row.outbound.idempotencyKey,
          attemptNumber: row.outbound.attemptCount + 1,
          mode: row.sequence.deliveryMode,
          outcome: "blocked",
          errorCode: "pre_send_gate",
          errorDetail: reason,
          decisionTrace: { allowed: false, checkedAt: now.toISOString(), reason }
        });
        return { outcome: "blocked", outboundMessageId, reason };
      }

      const prior = await transaction
        .select({
          internetMessageId: outboundMessages.internetMessageId,
          threadId: outboundMessages.threadId,
          subject: messageDrafts.subject
        })
        .from(outboundMessages)
        .innerJoin(messageDrafts, eq(messageDrafts.id, outboundMessages.messageDraftId))
        .where(
          and(
            eq(outboundMessages.sequenceId, sequenceId),
            sql`${outboundMessages.sequenceStep} < ${row.outbound.sequenceStep}`,
            inArray(outboundMessages.deliveryStatus, ["sent", "dry_run"])
          )
        )
        .orderBy(asc(outboundMessages.sequenceStep));
      const attemptNumber = row.outbound.attemptCount + 1;
      await transaction
        .update(outboundMessages)
        .set({
          deliveryStatus: "sending",
          claimedAt: now,
          attemptCount: attemptNumber,
          updatedAt: now
        })
        .where(
          and(
            eq(outboundMessages.id, outboundMessageId),
            eq(outboundMessages.deliveryStatus, "scheduled")
          )
        );
      await transaction
        .update(sequences)
        .set({ status: "active", currentStep: row.outbound.sequenceStep, updatedAt: now })
        .where(eq(sequences.id, sequenceId));
      await transaction.insert(auditLog).values({
        actorType: "system",
        actorId: "outreach-worker",
        action: "outreach.send_claimed",
        entityType: "outbound_message",
        entityId: outboundMessageId,
        after: {
          idempotencyKey: row.outbound.idempotencyKey,
          attemptNumber,
          mode: row.sequence.deliveryMode
        }
      });
      const originalRecipientEmail = normalizedEmail(row.contact.normalizedValue);
      const recipientEmail =
        row.sequence.deliveryMode === "sandbox"
          ? normalizedEmail(gate.sandboxRecipient)
          : originalRecipientEmail;
      return {
        outcome: "claimed",
        message: {
          outboundMessageId,
          sequenceId,
          senderId: row.sequence.senderId,
          mode: row.sequence.deliveryMode,
          senderEmail: normalizedEmail(row.sender.email),
          recipientEmail,
          originalRecipientEmail,
          subject:
            row.draft.subject ?? prior[0]?.subject ?? `A thought for ${row.organizationDomain}`,
          body: row.draft.body,
          internetMessageId: row.outbound.internetMessageId,
          threadId: prior[0]?.threadId ?? null,
          inReplyTo: prior.at(-1)?.internetMessageId ?? null,
          references: prior.map((entry) => entry.internetMessageId),
          attemptNumber,
          businessContactEmail: gate.businessContactEmail,
          physicalPostalAddress:
            complianceOutput?.footerRequirements.includes("physical_postal_address") === true
              ? (gate.businessPostalAddress ?? null)
              : null,
          advertisementDisclosure:
            complianceOutput?.footerRequirements.includes("advertisement_disclosure") === true,
          decisionTrace: {
            allowed: true,
            checkedAt: now.toISOString(),
            mode: row.sequence.deliveryMode,
            suppressionChecked: true,
            latestApprovalChecked: true,
            capsChecked: true,
            killSwitchesChecked: true,
            complianceDecisionId: row.sequence.complianceDecisionId,
            compliancePolicyVersion: complianceOutput?.policyVersion ?? null,
            recipientRewritten: row.sequence.deliveryMode === "sandbox"
          }
        }
      };
    });
  }

  public async completeOutbound(
    outboundMessageId: string,
    outcome: "dry_run" | "sent" | "delivery_unknown",
    details: {
      readonly providerMessageId?: string;
      readonly threadId?: string;
      readonly error?: string;
      readonly decisionTrace: Readonly<Record<string, unknown>>;
    },
    now = new Date()
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [candidate] = await transaction
        .select({ sequenceId: outboundMessages.sequenceId })
        .from(outboundMessages)
        .where(eq(outboundMessages.id, outboundMessageId))
        .limit(1);
      if (candidate === undefined) {
        throw new OutreachStateError("Only a claimed outbound can be completed.");
      }
      await transaction
        .select({ id: sequences.id })
        .from(sequences)
        .where(eq(sequences.id, candidate.sequenceId))
        .limit(1)
        .for("update");
      const [row] = await transaction
        .select({
          outbound: outboundMessages,
          sequence: sequences
        })
        .from(outboundMessages)
        .innerJoin(sequences, eq(sequences.id, outboundMessages.sequenceId))
        .where(eq(outboundMessages.id, outboundMessageId))
        .limit(1)
        .for("update", { of: outboundMessages });
      if (row === undefined || row.outbound.deliveryStatus !== "sending") {
        throw new OutreachStateError("Only a claimed outbound can be completed.");
      }
      await transaction
        .update(outboundMessages)
        .set({
          deliveryStatus: outcome,
          sentAt: outcome === "sent" ? now : null,
          providerMessageId: details.providerMessageId ?? null,
          threadId: details.threadId ?? null,
          error: details.error?.slice(0, 1_000) ?? null,
          updatedAt: now
        })
        .where(eq(outboundMessages.id, outboundMessageId));
      await transaction.insert(sendAttempts).values({
        outboundMessageId,
        idempotencyKey: row.outbound.idempotencyKey,
        attemptNumber: row.outbound.attemptCount,
        mode: row.sequence.deliveryMode,
        outcome,
        providerMessageId: details.providerMessageId ?? null,
        threadId: details.threadId ?? null,
        errorCode: outcome === "delivery_unknown" ? "provider_outcome_unknown" : null,
        errorDetail: details.error?.slice(0, 1_000) ?? null,
        decisionTrace: details.decisionTrace
      });
      if (outcome === "delivery_unknown") {
        await transaction
          .update(sequences)
          .set({
            status: "stopped",
            stoppedAt: now,
            stopReason: "delivery_unknown",
            updatedAt: now
          })
          .where(eq(sequences.id, row.sequence.id));
      } else if (
        outcome === "sent" &&
        row.sequence.deliveryMode === "production" &&
        !["stopped", "start_failed", "completed"].includes(row.sequence.status)
      ) {
        const [lead] = await transaction
          .select({ status: leads.status })
          .from(leads)
          .where(eq(leads.id, row.sequence.leadId))
          .limit(1)
          .for("update");
        const nextStatus = row.outbound.sequenceStep === 3 ? "follow_up_wait" : "contacted";
        if (lead !== undefined && lead.status !== nextStatus) {
          await transaction
            .update(leads)
            .set({ status: nextStatus, updatedAt: now })
            .where(eq(leads.id, row.sequence.leadId));
          await transaction.insert(leadStatusHistory).values({
            leadId: row.sequence.leadId,
            fromStatus: lead.status,
            toStatus: nextStatus,
            reason: `Production outreach touch ${row.outbound.sequenceStep} accepted by Gmail.`,
            actorId: "outreach-worker"
          });
        }
      }
    });
  }

  public async setSequencePaused(
    sequenceId: string,
    paused: boolean,
    actorId: string
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({ status: sequences.status })
        .from(sequences)
        .where(eq(sequences.id, sequenceId))
        .limit(1)
        .for("update");
      if (row === undefined) {
        throw new OutreachStateError("Sequence was not found.");
      }
      const allowed = paused
        ? ["scheduled", "active"].includes(row.status)
        : row.status === "paused";
      if (!allowed) {
        throw new OutreachStateError(`Sequence cannot be ${paused ? "paused" : "resumed"}.`);
      }
      await transaction
        .update(sequences)
        .set({ status: paused ? "paused" : "active", updatedAt: new Date() })
        .where(eq(sequences.id, sequenceId));
      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: paused ? "outreach.sequence_paused" : "outreach.sequence_resumed",
        entityType: "sequence",
        entityId: sequenceId,
        after: { paused }
      });
    });
  }

  public async stopSequence(
    sequenceId: string,
    reason: SequenceStopReason,
    actorId = "outreach-workflow",
    now = new Date()
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({ status: sequences.status })
        .from(sequences)
        .where(eq(sequences.id, sequenceId))
        .limit(1)
        .for("update");
      if (row === undefined || ["stopped", "completed", "start_failed"].includes(row.status)) {
        return;
      }
      await transaction
        .update(sequences)
        .set({ status: "stopped", stoppedAt: now, stopReason: reason, updatedAt: now })
        .where(eq(sequences.id, sequenceId));
      await transaction
        .update(outboundMessages)
        .set({ deliveryStatus: "cancelled", error: reason, updatedAt: now })
        .where(
          and(
            eq(outboundMessages.sequenceId, sequenceId),
            eq(outboundMessages.deliveryStatus, "scheduled")
          )
        );
      await transaction.insert(auditLog).values({
        actorType: actorId === "outreach-workflow" ? "system" : "human",
        actorId,
        action: "outreach.sequence_stopped",
        entityType: "sequence",
        entityId: sequenceId,
        after: { reason }
      });
    });
  }

  public async completeSequence(sequenceId: string, now = new Date()): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          leadId: sequences.leadId,
          deliveryMode: sequences.deliveryMode,
          status: sequences.status
        })
        .from(sequences)
        .where(eq(sequences.id, sequenceId))
        .limit(1)
        .for("update");
      if (row === undefined) {
        return;
      }
      if (row.status === "stopped" || row.status === "start_failed") {
        return;
      }
      await transaction
        .update(sequences)
        .set({
          status: "completed",
          stoppedAt: now,
          stopReason: "completed_no_response",
          updatedAt: now
        })
        .where(
          and(
            eq(sequences.id, sequenceId),
            ne(sequences.status, "stopped"),
            ne(sequences.status, "start_failed")
          )
        );
      if (row.deliveryMode === "production") {
        const [lead] = await transaction
          .select({ status: leads.status })
          .from(leads)
          .where(eq(leads.id, row.leadId))
          .limit(1)
          .for("update");
        if (lead !== undefined) {
          await transaction
            .update(leads)
            .set({ status: "no_response_nurture", nextActionAt: null, updatedAt: now })
            .where(eq(leads.id, row.leadId));
          await transaction.insert(leadStatusHistory).values({
            leadId: row.leadId,
            fromStatus: lead.status,
            toStatus: "no_response_nurture",
            reason: "Production sequence completed without a reply.",
            actorId: "outreach-workflow"
          });
        }
      }
    });
  }
}
