import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
  contactIsActionable,
  leadStatusSchema,
  messageBriefSchema,
  messageDraftContentSchema,
  messageQaReviewSchema,
  messageSequenceSchema,
  type LeadStatus,
  type MessageBrief,
  type MessageDraftContent,
  type MessageQaReview,
  type MessageSequence
} from "@innovateats/shared";

import type { AppDatabase } from "../client.js";
import {
  auditLog,
  contacts,
  evidence,
  leads,
  leadStatusHistory,
  messageApprovals,
  messageDrafts,
  organizations,
  strategyBriefs,
  suppressionList
} from "../schema/index.js";
import { LeadNotFoundError } from "./crm.js";

export type MessageDecision = "approved" | "rejected";

export interface StrategyBriefRecord {
  readonly id: string;
  readonly leadId: string;
  readonly contactId: string;
  readonly diagnosis: string;
  readonly opportunity: string;
  readonly mateoFit: string;
  readonly brief: MessageBrief;
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export interface MessageApprovalRecord {
  readonly id: string;
  readonly decision: MessageDecision;
  readonly reason: string | null;
  readonly actorId: string;
  readonly createdAt: Date;
}

export interface MessageDraftRecord extends MessageDraftContent {
  readonly id: string;
  readonly strategyBriefId: string;
  readonly leadId: string;
  readonly contactId: string;
  readonly version: number;
  readonly supersedesId: string | null;
  readonly editSource: "agent" | "human";
  readonly qa: MessageQaReview;
  readonly approval: MessageApprovalRecord | null;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export interface MessageWorkspace {
  readonly brief: StrategyBriefRecord | null;
  readonly drafts: readonly MessageDraftRecord[];
}

export interface SaveGeneratedSequenceResult {
  readonly workspace: MessageWorkspace;
  readonly leadStatus: LeadStatus;
}

export interface ApprovalResult {
  readonly decision: MessageDecision;
  readonly allCurrentDraftsApproved: boolean;
}

export class MessageStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MessageStateError";
  }
}

export class MessageDraftNotFoundError extends Error {
  public constructor() {
    super("Message draft not found.");
    this.name = "MessageDraftNotFoundError";
  }
}

function toDraftRecord(
  row: typeof messageDrafts.$inferSelect,
  approval: MessageApprovalRecord | null
): MessageDraftRecord {
  const content = messageDraftContentSchema.parse({
    channel: row.channel,
    sequenceStep: row.sequenceStep,
    subject: row.subject,
    body: row.body,
    language: row.language,
    personalizationTokens: row.personalizationTokens,
    evidenceMap: row.evidenceMap,
    wordCount: row.wordCount
  });
  return {
    ...content,
    id: row.id,
    strategyBriefId: row.strategyBriefId,
    leadId: row.leadId,
    contactId: row.contactId,
    version: row.version,
    supersedesId: row.supersedesId,
    editSource: row.editSource,
    qa: messageQaReviewSchema.parse(row.qa),
    approval,
    createdBy: row.createdBy,
    createdAt: row.createdAt
  };
}

function transitionReason(status: LeadStatus): string {
  if (status === "message_drafted") {
    return "Evidence-backed three-touch sequence drafted";
  }
  if (status === "qa_passed") {
    return "Factuality, specificity, and sales QA passed";
  }
  return "Human approval required before scheduling";
}

export class PostgresMessageRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async getWorkspace(leadId: string): Promise<MessageWorkspace> {
    const [briefRow] = await this.database
      .select()
      .from(strategyBriefs)
      .where(eq(strategyBriefs.leadId, leadId))
      .orderBy(desc(strategyBriefs.createdAt))
      .limit(1);
    if (briefRow === undefined) {
      return { brief: null, drafts: [] };
    }

    const draftRows = await this.database
      .select()
      .from(messageDrafts)
      .where(eq(messageDrafts.strategyBriefId, briefRow.id))
      .orderBy(asc(messageDrafts.sequenceStep), asc(messageDrafts.version));
    const draftIds = draftRows.map((draft) => draft.id);
    const approvalRows =
      draftIds.length === 0
        ? []
        : await this.database
            .select()
            .from(messageApprovals)
            .where(inArray(messageApprovals.messageDraftId, draftIds));
    const approvalByDraft = new Map<string, MessageApprovalRecord>(
      approvalRows.map((approval) => [
        approval.messageDraftId,
        {
          id: approval.id,
          decision: approval.decision,
          reason: approval.reason,
          actorId: approval.actorId,
          createdAt: approval.createdAt
        }
      ])
    );

    return {
      brief: {
        id: briefRow.id,
        leadId: briefRow.leadId,
        contactId: briefRow.contactId,
        diagnosis: briefRow.diagnosis,
        opportunity: briefRow.opportunity,
        mateoFit: briefRow.mateoFit,
        brief: messageBriefSchema.parse(briefRow.brief),
        version: briefRow.version,
        createdBy: briefRow.createdBy,
        createdAt: briefRow.createdAt
      },
      drafts: draftRows.map((row) => toDraftRecord(row, approvalByDraft.get(row.id) ?? null))
    };
  }

  public async saveGeneratedSequence(
    leadId: string,
    rawBrief: MessageBrief,
    rawSequence: MessageSequence,
    rawReviews: readonly MessageQaReview[],
    actorId: string
  ): Promise<SaveGeneratedSequenceResult> {
    const brief = messageBriefSchema.parse(rawBrief);
    const sequence = messageSequenceSchema.parse(rawSequence);
    const reviews = rawReviews.map((review) => messageQaReviewSchema.parse(review));
    if (reviews.length !== 3 || reviews.some((review) => !review.passed)) {
      throw new MessageStateError("All three drafts must pass QA before they can be stored.");
    }

    await this.database.transaction(async (transaction) => {
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
      if (currentStatus !== "contact_found") {
        throw new MessageStateError(
          `Message generation is valid only from contact_found, not ${currentStatus}.`
        );
      }
      const [organization] = await transaction
        .select({ displayName: organizations.displayName })
        .from(organizations)
        .where(eq(organizations.id, lead.organizationId))
        .limit(1);
      if (organization === undefined || organization.displayName !== brief.brandName) {
        throw new MessageStateError("The strategy brief brand must match the lead organization.");
      }

      const [contact] = await transaction
        .select()
        .from(contacts)
        .where(
          and(eq(contacts.id, brief.contactId), eq(contacts.organizationId, lead.organizationId))
        )
        .limit(1);
      if (
        contact === undefined ||
        contact.doNotContact ||
        (contact.channelType !== "corporate_email" &&
          contact.channelType !== "named_business_email") ||
        !contactIsActionable(contact.origin, contact.verificationStatus)
      ) {
        throw new MessageStateError(
          "Message generation requires an actionable, non-suppressed email contact."
        );
      }

      const uniqueEvidenceIds = [...new Set(brief.evidenceIds)];
      const evidenceRows = await transaction
        .select({ id: evidence.id })
        .from(evidence)
        .where(
          and(
            eq(evidence.leadId, leadId),
            eq(evidence.state, "active"),
            inArray(evidence.id, uniqueEvidenceIds)
          )
        );
      if (evidenceRows.length !== uniqueEvidenceIds.length) {
        throw new MessageStateError("Every cited evidence item must be active on this lead.");
      }

      const [strategy] = await transaction
        .insert(strategyBriefs)
        .values({
          leadId,
          contactId: brief.contactId,
          language: brief.language,
          diagnosis: `${brief.discoveryFact} Next execution step: ${brief.nextExecutionStep}.`,
          opportunity: brief.specificOpportunity,
          mateoFit: brief.selectedCredentials.join(", "),
          brief,
          evidenceIds: brief.evidenceIds,
          createdBy: actorId
        })
        .returning({ id: strategyBriefs.id });
      if (strategy === undefined) {
        throw new Error("Strategy brief insert returned no record.");
      }

      for (const [index, draft] of sequence.drafts.entries()) {
        const review = reviews[index];
        if (review === undefined) {
          throw new MessageStateError("Every draft requires a QA review.");
        }
        await transaction.insert(messageDrafts).values({
          strategyBriefId: strategy.id,
          leadId,
          contactId: brief.contactId,
          channel: draft.channel,
          sequenceStep: draft.sequenceStep,
          subject: draft.subject,
          body: draft.body,
          personalizationTokens: draft.personalizationTokens,
          evidenceMap: draft.evidenceMap,
          wordCount: draft.wordCount,
          language: draft.language,
          editSource: "agent",
          qa: review,
          qaPassed: review.passed,
          createdBy: actorId
        });
      }

      let fromStatus: LeadStatus = currentStatus;
      for (const toStatus of [
        "message_drafted",
        "qa_passed",
        "approval_pending"
      ] as const satisfies readonly LeadStatus[]) {
        await transaction
          .update(leads)
          .set({ status: toStatus, updatedAt: new Date() })
          .where(eq(leads.id, leadId));
        await transaction.insert(leadStatusHistory).values({
          leadId,
          fromStatus,
          toStatus,
          reason: transitionReason(toStatus),
          actorId
        });
        fromStatus = toStatus;
      }

      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: "message.sequence_generated",
        entityType: "lead",
        entityId: leadId,
        before: { status: currentStatus },
        after: {
          status: "approval_pending",
          strategyBriefId: strategy.id,
          contactId: brief.contactId,
          draftCount: sequence.drafts.length
        }
      });
    });

    return { workspace: await this.getWorkspace(leadId), leadStatus: "approval_pending" };
  }

  public async versionDraft(
    leadId: string,
    draftId: string,
    rawContent: MessageDraftContent,
    rawReview: MessageQaReview,
    actorId: string
  ): Promise<MessageDraftRecord> {
    const content = messageDraftContentSchema.parse(rawContent);
    const review = messageQaReviewSchema.parse(rawReview);
    if (!review.passed) {
      throw new MessageStateError("A human edit must pass QA before a version is stored.");
    }

    const createdId = await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({ draft: messageDrafts, leadStatus: leads.status })
        .from(messageDrafts)
        .innerJoin(leads, eq(leads.id, messageDrafts.leadId))
        .where(and(eq(messageDrafts.id, draftId), eq(messageDrafts.leadId, leadId)))
        .limit(1)
        .for("update", { of: messageDrafts });
      if (row === undefined) {
        throw new MessageDraftNotFoundError();
      }
      if (leadStatusSchema.parse(row.leadStatus) !== "approval_pending") {
        throw new MessageStateError("Draft editing requires the approval_pending lead state.");
      }
      const [newer] = await transaction
        .select({ id: messageDrafts.id })
        .from(messageDrafts)
        .where(eq(messageDrafts.supersedesId, draftId))
        .limit(1);
      if (newer !== undefined) {
        throw new MessageStateError("Only the latest message draft version can be edited.");
      }
      if (
        content.sequenceStep !== row.draft.sequenceStep ||
        content.language !== row.draft.language ||
        content.channel !== row.draft.channel
      ) {
        throw new MessageStateError("A human edit cannot change step, language, or channel.");
      }

      const [created] = await transaction
        .insert(messageDrafts)
        .values({
          strategyBriefId: row.draft.strategyBriefId,
          leadId,
          contactId: row.draft.contactId,
          channel: content.channel,
          sequenceStep: content.sequenceStep,
          subject: content.subject,
          body: content.body,
          personalizationTokens: content.personalizationTokens,
          evidenceMap: content.evidenceMap,
          wordCount: content.wordCount,
          language: content.language,
          version: row.draft.version + 1,
          supersedesId: row.draft.id,
          editSource: "human",
          qa: review,
          qaPassed: review.passed,
          createdBy: actorId
        })
        .returning({ id: messageDrafts.id });
      if (created === undefined) {
        throw new Error("Message draft version insert returned no record.");
      }
      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: "message.draft_versioned",
        entityType: "message_draft",
        entityId: created.id,
        before: { draftId: row.draft.id, version: row.draft.version },
        after: { draftId: created.id, version: row.draft.version + 1 }
      });
      return created.id;
    });

    const workspace = await this.getWorkspace(leadId);
    const created = workspace.drafts.find((draft) => draft.id === createdId);
    if (created === undefined) {
      throw new Error("Created message draft version could not be reloaded.");
    }
    return created;
  }

  public async recordDecision(
    leadId: string,
    draftId: string,
    decision: MessageDecision,
    reason: string | null,
    actorId: string
  ): Promise<ApprovalResult> {
    if (decision === "rejected" && (reason === null || reason.trim() === "")) {
      throw new MessageStateError("A rejection requires a reason.");
    }

    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({ draft: messageDrafts, leadStatus: leads.status })
        .from(messageDrafts)
        .innerJoin(leads, eq(leads.id, messageDrafts.leadId))
        .where(and(eq(messageDrafts.id, draftId), eq(messageDrafts.leadId, leadId)))
        .limit(1)
        .for("update", { of: messageDrafts });
      if (row === undefined) {
        throw new MessageDraftNotFoundError();
      }
      if (leadStatusSchema.parse(row.leadStatus) !== "approval_pending") {
        throw new MessageStateError("Decisions require the approval_pending lead state.");
      }
      const [newer] = await transaction
        .select({ id: messageDrafts.id })
        .from(messageDrafts)
        .where(eq(messageDrafts.supersedesId, draftId))
        .limit(1);
      if (newer !== undefined) {
        throw new MessageStateError("Only the latest message draft version can be decided.");
      }
      if (!row.draft.qaPassed) {
        throw new MessageStateError("Only a QA-passed message draft can be decided.");
      }
      if (decision === "approved") {
        const [suppressed] = await transaction
          .select({ id: suppressionList.id })
          .from(contacts)
          .innerJoin(
            suppressionList,
            and(
              eq(suppressionList.normalizedContact, contacts.normalizedValue),
              eq(suppressionList.channel, "email")
            )
          )
          .where(eq(contacts.id, row.draft.contactId))
          .limit(1);
        if (suppressed !== undefined) {
          throw new MessageStateError("A suppressed contact message cannot be approved.");
        }
      }

      await transaction.insert(messageApprovals).values({
        messageDraftId: draftId,
        decision,
        reason: reason?.trim() || null,
        actorId
      });
      await transaction.insert(auditLog).values({
        actorType: "human",
        actorId,
        action: `message.${decision}`,
        entityType: "message_draft",
        entityId: draftId,
        after: { decision, reason: reason?.trim() || null }
      });

      const draftRows = await transaction
        .select({ id: messageDrafts.id, supersedesId: messageDrafts.supersedesId })
        .from(messageDrafts)
        .where(eq(messageDrafts.strategyBriefId, row.draft.strategyBriefId));
      const supersededIds = new Set(
        draftRows.flatMap((draft) => (draft.supersedesId === null ? [] : [draft.supersedesId]))
      );
      const currentIds = draftRows
        .filter((draft) => !supersededIds.has(draft.id))
        .map((draft) => draft.id);
      const approvals = await transaction
        .select()
        .from(messageApprovals)
        .where(inArray(messageApprovals.messageDraftId, currentIds));
      const decisions = new Map(
        approvals.map((approval) => [approval.messageDraftId, approval.decision])
      );
      const allCurrentDraftsApproved =
        currentIds.length === 3 && currentIds.every((id) => decisions.get(id) === "approved");

      return { decision, allCurrentDraftsApproved };
    });
  }
}
