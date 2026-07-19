import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import type {
  ContactChannelType,
  ContactOrigin,
  ContactVerificationStatus,
  ComplianceDecisionName,
  ComplianceDecisionResult,
  ComplianceInput,
  ConsentStatus,
  EmailProviderVerdict,
  IcpDimensionKey,
  IcpRecommendedAction,
  IcpScoreBreakdown,
  MessageBrief,
  MessageDraftContent,
  MessageLanguage,
  MessageQaReview,
  HandoffPacket,
  GmailDeliveryMode,
  ReplyClassificationName,
  ReplyRequestedAction,
  OutboundDeliveryStatus,
  OutreachChannel,
  OutreachSequenceStatus,
  RegionPolicy,
  SubscriberType,
  LanguageProficiency
} from "@innovateats/shared";

import { regions } from "./foundations.js";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    baseUrl: text("base_url"),
    termsStatus: text("terms_status").default("manual_review").notNull(),
    robotsStatus: text("robots_status").default("not_checked").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    config: jsonb("config_json").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [uniqueIndex("sources_type_name_unique").on(table.type, table.name)]
);

export const sourceDocuments = pgTable(
  "source_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    contentHash: text("content_hash"),
    title: text("title"),
    extractedText: text("extracted_text"),
    objectStorageKey: text("object_storage_key"),
    trustLevel: text("trust_level").default("user_provided").notNull(),
    metadata: jsonb("metadata_json").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("source_documents_manual_canonical_unique")
      .on(table.canonicalUrl)
      .where(sql`${table.contentHash} IS NULL`),
    uniqueIndex("source_documents_snapshot_unique")
      .on(table.canonicalUrl, table.contentHash)
      .where(sql`${table.contentHash} IS NOT NULL`),
    index("source_documents_source_index").on(table.sourceId)
  ]
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    normalizedName: text("normalized_name").notNull(),
    displayName: text("display_name").notNull(),
    canonicalDomain: text("canonical_domain").notNull(),
    country: text("country").default("Unknown").notNull(),
    regionId: uuid("region_id").references(() => regions.id, { onDelete: "set null" }),
    stage: text("stage").default("unknown").notNull(),
    productSummary: text("product_summary"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("organizations_domain_unique").on(table.canonicalDomain),
    index("organizations_normalized_name_index").on(table.normalizedName),
    index("organizations_region_index").on(table.regionId)
  ]
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    status: text("status").default("discovered").notNull(),
    icpScore: integer("icp_score").default(0).notNull(),
    scoreConfidence: real("score_confidence").default(0).notNull(),
    hardExclusion: boolean("hard_exclusion").default(false).notNull(),
    exclusionReason: text("exclusion_reason"),
    discoverySignal: text("discovery_signal"),
    currentOwner: text("current_owner"),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    firstDiscoveredAt: timestamp("first_discovered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastResearchedAt: timestamp("last_researched_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("leads_organization_unique").on(table.organizationId),
    index("leads_status_index").on(table.status),
    index("leads_score_index").on(table.icpScore),
    index("leads_next_action_index").on(table.nextActionAt)
  ]
);

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "restrict" }),
    sourceDocumentId: uuid("source_document_id").references(() => sourceDocuments.id, {
      onDelete: "restrict"
    }),
    factType: text("fact_type").notNull(),
    claim: text("claim").notNull(),
    quoteOrSummary: text("quote_or_summary").notNull(),
    sourceUrl: text("source_url").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    confidence: real("confidence").notNull(),
    isInference: boolean("is_inference").default(false).notNull(),
    version: integer("version").default(1).notNull(),
    supersedesId: uuid("supersedes_id"),
    state: text("state").default("active").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    supersededAt: timestamp("superseded_at", { withTimezone: true })
  },
  (table) => [
    index("evidence_lead_state_index").on(table.leadId, table.state),
    index("evidence_source_document_index").on(table.sourceDocumentId),
    uniqueIndex("evidence_supersedes_unique").on(table.supersedesId)
  ]
);

export const leadStatusHistory = pgTable(
  "lead_status_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "restrict" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    actorId: text("actor_id").notNull(),
    createdAt: createdAt()
  },
  (table) => [index("lead_status_history_lead_index").on(table.leadId, table.createdAt)]
);

export const founders = pgTable(
  "founders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    role: text("role").notNull(),
    publicProfileUrls: jsonb("public_profile_urls_json")
      .$type<readonly string[]>()
      .default([])
      .notNull(),
    confidence: real("confidence").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("founders_organization_name_unique").on(table.organizationId, table.normalizedName),
    index("founders_organization_index").on(table.organizationId)
  ]
);

export const leadScores = pgTable(
  "lead_scores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "restrict" }),
    rubricVersion: text("rubric_version").notNull(),
    breakdown: jsonb("breakdown_json").$type<IcpScoreBreakdown>().notNull(),
    explanations: jsonb("explanations_json")
      .$type<Readonly<Record<IcpDimensionKey, string>>>()
      .notNull(),
    total: integer("total").notNull(),
    confidence: real("confidence").notNull(),
    evidenceIds: jsonb("evidence_ids_json").$type<readonly string[]>().notNull(),
    missingInformation: jsonb("missing_information_json")
      .$type<readonly string[]>()
      .default([])
      .notNull(),
    hardExclusion: boolean("hard_exclusion").default(false).notNull(),
    exclusionReason: text("exclusion_reason"),
    recommendedAction: text("recommended_action").$type<IcpRecommendedAction>().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt()
  },
  (table) => [
    index("lead_scores_lead_created_index").on(table.leadId, table.createdAt),
    index("lead_scores_total_index").on(table.total)
  ]
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentName: text("agent_name").notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    inputHash: text("input_hash").notNull(),
    output: jsonb("output_json").$type<Record<string, unknown> | null>(),
    traceId: text("trace_id"),
    tokensIn: integer("tokens_in").default(0).notNull(),
    tokensOut: integer("tokens_out").default(0).notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).default("0").notNull(),
    status: text("status").default("running").notNull(),
    error: text("error"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("agent_runs_idempotency_unique").on(
      table.agentName,
      table.promptVersion,
      table.inputHash
    ),
    index("agent_runs_status_index").on(table.status),
    index("agent_runs_created_index").on(table.createdAt)
  ]
);

export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentName: text("agent_name").notNull(),
    version: text("version").notNull(),
    contentHash: text("content_hash").notNull(),
    configuration: jsonb("configuration_json")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    status: text("status").$type<"draft" | "active" | "retired">().default("draft").notNull(),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("prompt_version_unique").on(table.agentName, table.version),
    uniqueIndex("prompt_active_agent_unique")
      .on(table.agentName)
      .where(sql`${table.status} = 'active'`)
  ]
);

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    suiteVersion: text("suite_version").notNull(),
    datasetVersion: text("dataset_version").notNull(),
    commitSha: text("commit_sha"),
    status: text("status").$type<"running" | "passed" | "failed">().default("running").notNull(),
    report: jsonb("report_json").$type<Record<string, unknown> | null>(),
    automatedPassed: boolean("automated_passed"),
    pilotReady: boolean("pilot_ready"),
    startedBy: text("started_by").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [index("eval_runs_status_started_index").on(table.status, table.startedAt)]
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    founderId: uuid("founder_id").references(() => founders.id, { onDelete: "restrict" }),
    sourceDocumentId: uuid("source_document_id")
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: "restrict" }),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "restrict" }),
    fullName: text("full_name"),
    role: text("role"),
    channelType: text("channel_type").$type<ContactChannelType>().notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    directUrl: text("direct_url").notNull(),
    sourceUrl: text("source_url").notNull(),
    origin: text("origin").$type<ContactOrigin>().notNull(),
    provenance: text("provenance").notNull(),
    verificationStatus: text("verification_status")
      .$type<ContactVerificationStatus>()
      .default("unverified")
      .notNull(),
    verificationProvider: text("verification_provider"),
    isPersonalData: boolean("is_personal_data").default(false).notNull(),
    corporateSubscriberStatus: text("corporate_subscriber_status").default("unknown").notNull(),
    subscriberType: text("subscriber_type").$type<SubscriberType>().default("unknown").notNull(),
    consentStatus: text("consent_status").$type<ConsentStatus>().default("unknown").notNull(),
    languageProficiency: text("language_proficiency")
      .$type<LanguageProficiency>()
      .default("unknown")
      .notNull(),
    complianceEvidence: jsonb("compliance_evidence_json")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    complianceReviewedBy: text("compliance_reviewed_by"),
    complianceReviewedAt: timestamp("compliance_reviewed_at", { withTimezone: true }),
    country: text("country"),
    confidence: real("confidence").notNull(),
    doNotContact: boolean("do_not_contact").default(false).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("contacts_organization_channel_value_unique").on(
      table.organizationId,
      table.channelType,
      table.normalizedValue
    ),
    index("contacts_organization_index").on(table.organizationId),
    index("contacts_verification_index").on(table.verificationStatus),
    index("contacts_evidence_index").on(table.evidenceId)
  ]
);

export const contactVerifications = pgTable(
  "contact_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    status: text("status").$type<ContactVerificationStatus>().notNull(),
    provider: text("provider"),
    syntaxValid: boolean("syntax_valid").notNull(),
    mxFound: boolean("mx_found").notNull(),
    providerVerdict: text("provider_verdict").$type<EmailProviderVerdict>().notNull(),
    reason: text("reason").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    result: jsonb("result_json").$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt()
  },
  (table) => [index("contact_verifications_contact_index").on(table.contactId, table.checkedAt)]
);

export const strategyBriefs = pgTable(
  "strategy_briefs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    language: text("language").$type<MessageLanguage>().notNull(),
    diagnosis: text("diagnosis").notNull(),
    opportunity: text("opportunity").notNull(),
    mateoFit: text("mateo_fit").notNull(),
    brief: jsonb("brief_json").$type<MessageBrief>().notNull(),
    evidenceIds: jsonb("evidence_ids_json").$type<readonly string[]>().notNull(),
    version: integer("version").default(1).notNull(),
    supersedesId: uuid("supersedes_id"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("strategy_briefs_supersedes_unique").on(table.supersedesId),
    index("strategy_briefs_lead_created_index").on(table.leadId, table.createdAt)
  ]
);

export const messageDrafts = pgTable(
  "message_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    strategyBriefId: uuid("strategy_brief_id")
      .notNull()
      .references(() => strategyBriefs.id, { onDelete: "restrict" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    channel: text("channel").default("email").notNull(),
    sequenceStep: integer("sequence_step").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    personalizationTokens: jsonb("personalization_tokens_json")
      .$type<MessageDraftContent["personalizationTokens"]>()
      .notNull(),
    evidenceMap: jsonb("evidence_map_json").$type<MessageDraftContent["evidenceMap"]>().notNull(),
    wordCount: integer("word_count").notNull(),
    language: text("language").$type<MessageLanguage>().notNull(),
    version: integer("version").default(1).notNull(),
    supersedesId: uuid("supersedes_id"),
    editSource: text("edit_source").$type<"agent" | "human">().default("agent").notNull(),
    qa: jsonb("qa_json").$type<MessageQaReview>().notNull(),
    qaPassed: boolean("qa_passed").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("message_drafts_brief_step_version_unique").on(
      table.strategyBriefId,
      table.sequenceStep,
      table.version
    ),
    uniqueIndex("message_drafts_supersedes_unique").on(table.supersedesId),
    index("message_drafts_lead_step_created_index").on(
      table.leadId,
      table.sequenceStep,
      table.createdAt
    )
  ]
);

export const messageApprovals = pgTable(
  "message_approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageDraftId: uuid("message_draft_id")
      .notNull()
      .references(() => messageDrafts.id, { onDelete: "restrict" }),
    decision: text("decision").$type<"approved" | "rejected">().notNull(),
    reason: text("reason"),
    actorId: text("actor_id").notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("message_approval_one_decision_per_version").on(table.messageDraftId),
    index("message_approvals_created_index").on(table.createdAt)
  ]
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    active: boolean("active").default(false).notNull(),
    sequenceVersion: text("sequence_version").notNull(),
    dailyCap: integer("daily_cap").default(10).notNull(),
    dailyDomainCap: integer("daily_domain_cap").default(1).notNull(),
    approvalMode: text("approval_mode")
      .$type<"draft_only" | "approved_send" | "autonomous_send">()
      .default("approved_send")
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [uniqueIndex("campaign_name_unique").on(table.name)]
);

export const pilotRuns = pgTable(
  "pilot_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    mode: text("mode")
      .$type<"simulation" | "sandbox" | "production">()
      .default("simulation")
      .notNull(),
    status: text("status")
      .$type<"planned" | "running" | "completed" | "aborted">()
      .default("planned")
      .notNull(),
    targetLeads: integer("target_leads").default(50).notNull(),
    allowedRegions: jsonb("allowed_regions_json").$type<readonly string[]>().notNull(),
    dailyEmailCap: integer("daily_email_cap").default(10).notNull(),
    reviewInterval: integer("review_interval").default(20).notNull(),
    humanApprovalRequired: boolean("human_approval_required").default(true).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    externalAuthorized: boolean("external_authorized").default(false).notNull(),
    authorizedBy: text("authorized_by"),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    signedResultsBy: text("signed_results_by"),
    signedResultsAt: timestamp("signed_results_at", { withTimezone: true }),
    result: jsonb("result_json").$type<Record<string, unknown> | null>(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("pilot_one_running_unique")
      .on(table.status)
      .where(sql`${table.status} = 'running'`),
    index("pilot_runs_status_window_index").on(table.status, table.startsAt, table.endsAt)
  ]
);

export const pilotReviewCheckpoints = pgTable(
  "pilot_review_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pilotRunId: uuid("pilot_run_id")
      .notNull()
      .references(() => pilotRuns.id, { onDelete: "restrict" }),
    afterMessageCount: integer("after_message_count").notNull(),
    metrics: jsonb("metrics_json").$type<Record<string, unknown>>().notNull(),
    decision: text("decision").$type<"continue" | "pause" | "abort">().notNull(),
    notes: text("notes").notNull(),
    reviewedBy: text("reviewed_by").notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("pilot_checkpoint_message_unique").on(table.pilotRunId, table.afterMessageCount)
  ]
);

export const goLiveChecklistItems = pgTable("go_live_checklist_items", {
  key: text("key").primaryKey(),
  category: text("category").notNull(),
  label: text("label").notNull(),
  status: text("status").$type<"unknown" | "passed" | "blocked">().default("unknown").notNull(),
  evidence: jsonb("evidence_json").$type<Record<string, unknown>>().default({}).notNull(),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const messageQualityReviews = pgTable(
  "message_quality_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageDraftId: uuid("message_draft_id")
      .notNull()
      .references(() => messageDrafts.id, { onDelete: "restrict" }),
    researchAccuracy: integer("research_accuracy").notNull(),
    opportunityInsight: integer("opportunity_insight").notNull(),
    innovateatsFit: integer("innovateats_fit").notNull(),
    mateoCredibility: integer("mateo_credibility").notNull(),
    naturalness: integer("naturalness").notNull(),
    ctaQuality: integer("cta_quality").notNull(),
    riskSafety: integer("risk_safety").notNull(),
    averageScore: numeric("average_score", { precision: 4, scale: 2 }).notNull(),
    notes: text("notes").notNull(),
    reviewedBy: text("reviewed_by").notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("message_quality_review_draft_unique").on(table.messageDraftId),
    index("message_quality_review_created_index").on(table.createdAt)
  ]
);

export const senders = pgTable(
  "senders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    active: boolean("active").default(false).notNull(),
    sandbox: boolean("sandbox").default(true).notNull(),
    dailyCap: integer("daily_cap").default(10).notNull(),
    timezone: text("timezone").default("Europe/Madrid").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [uniqueIndex("sender_email_unique").on(table.email)]
);

export const gmailOauthStates = pgTable("gmail_oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  senderEmail: text("sender_email").notNull(),
  returnPath: text("return_path").notNull(),
  actorId: text("actor_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: createdAt()
});

export const gmailCredentials = pgTable(
  "gmail_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => senders.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
    scopes: jsonb("scopes_json").$type<readonly string[]>().notNull(),
    grantedBy: text("granted_by").notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("gmail_credential_sender_version_unique").on(table.senderId, table.version),
    index("gmail_credentials_sender_created_index").on(table.senderId, table.createdAt)
  ]
);

export const suppressionList = pgTable(
  "suppression_list",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    normalizedContact: text("normalized_contact").notNull(),
    contactHash: text("contact_hash").notNull(),
    channel: text("channel").default("email").notNull(),
    reason: text("reason").notNull(),
    source: text("source").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("suppression_contact_channel_unique").on(table.normalizedContact, table.channel),
    index("suppression_contact_hash_index").on(table.contactHash)
  ]
);

export const regionPolicyVersions = pgTable(
  "region_policy_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    regionId: uuid("region_id")
      .notNull()
      .references(() => regions.id, { onDelete: "restrict" }),
    version: text("version").notNull(),
    policy: jsonb("policy_json").$type<RegionPolicy>().notNull(),
    contentHash: text("content_hash").notNull(),
    status: text("status").$type<"draft" | "active" | "retired">().default("draft").notNull(),
    sourceUrls: jsonb("source_urls_json").$type<readonly string[]>().notNull(),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("region_policy_version_unique").on(table.regionId, table.version),
    uniqueIndex("region_policy_active_unique")
      .on(table.regionId)
      .where(sql`${table.status} = 'active'`),
    index("region_policy_status_index").on(table.status, table.createdAt)
  ]
);

export const complianceDecisions = pgTable(
  "compliance_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    regionPolicyId: uuid("region_policy_id")
      .notNull()
      .references(() => regionPolicyVersions.id, { onDelete: "restrict" }),
    regionPolicyVersion: text("region_policy_version").notNull(),
    channel: text("channel").$type<OutreachChannel>().notNull(),
    decision: text("decision").$type<ComplianceDecisionName>().notNull(),
    reasons: jsonb("reasons_json").$type<readonly string[]>().notNull(),
    legalBasisTag: text("legal_basis_tag").notNull(),
    inputHash: text("input_hash").notNull(),
    input: jsonb("input_json").$type<ComplianceInput>().notNull(),
    output: jsonb("output_json").$type<ComplianceDecisionResult>().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt()
  },
  (table) => [
    index("compliance_decision_association_index").on(
      table.leadId,
      table.contactId,
      table.campaignId,
      table.createdAt
    ),
    index("compliance_decision_policy_index").on(table.regionPolicyId, table.createdAt)
  ]
);

export const socialManualQueue = pgTable(
  "social_manual_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    complianceDecisionId: uuid("compliance_decision_id")
      .notNull()
      .references(() => complianceDecisions.id, { onDelete: "restrict" }),
    channel: text("channel").$type<Exclude<OutreachChannel, "email">>().notNull(),
    directUrl: text("direct_url").notNull(),
    message: text("message").notNull(),
    status: text("status")
      .$type<"draft" | "copied" | "marked_sent" | "cancelled">()
      .default("draft")
      .notNull(),
    reminderAt: timestamp("reminder_at", { withTimezone: true }),
    copiedAt: timestamp("copied_at", { withTimezone: true }),
    markedSentAt: timestamp("marked_sent_at", { withTimezone: true }),
    automaticActionAttempted: boolean("automatic_action_attempted").default(false).notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    index("social_manual_lead_index").on(table.leadId, table.createdAt),
    index("social_manual_reminder_index").on(table.status, table.reminderAt)
  ]
);

export const sequences = pgTable(
  "sequences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => senders.id, { onDelete: "restrict" }),
    complianceDecisionId: uuid("compliance_decision_id").references(() => complianceDecisions.id, {
      onDelete: "restrict"
    }),
    workflowId: text("workflow_id").notNull(),
    status: text("status").$type<OutreachSequenceStatus>().default("pending_workflow").notNull(),
    currentStep: integer("current_step").default(0).notNull(),
    recipientTimezone: text("recipient_timezone").notNull(),
    deliveryMode: text("delivery_mode").$type<GmailDeliveryMode>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    stopReason: text("stop_reason"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("sequence_workflow_unique").on(table.workflowId),
    index("sequences_status_index").on(table.status, table.updatedAt)
  ]
);

export const outboundMessages = pgTable(
  "outbound_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sequenceId: uuid("sequence_id")
      .notNull()
      .references(() => sequences.id, { onDelete: "restrict" }),
    messageDraftId: uuid("message_draft_id")
      .notNull()
      .references(() => messageDrafts.id, { onDelete: "restrict" }),
    sequenceStep: integer("sequence_step").notNull(),
    providerMessageId: text("provider_message_id"),
    threadId: text("thread_id"),
    internetMessageId: text("internet_message_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveryStatus: text("delivery_status")
      .$type<OutboundDeliveryStatus>()
      .default("scheduled")
      .notNull(),
    bounceType: text("bounce_type").$type<"hard" | "soft" | "unknown">(),
    error: text("error"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    decisionTrace: jsonb("decision_trace_json").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("outbound_idempotency_unique").on(table.idempotencyKey),
    uniqueIndex("outbound_sequence_step_unique").on(table.sequenceId, table.sequenceStep),
    index("outbound_schedule_index").on(table.deliveryStatus, table.scheduledAt),
    index("outbound_thread_index").on(table.threadId)
  ]
);

export const sendAttempts = pgTable(
  "send_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    outboundMessageId: uuid("outbound_message_id")
      .notNull()
      .references(() => outboundMessages.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    mode: text("mode").$type<GmailDeliveryMode>().notNull(),
    outcome: text("outcome")
      .$type<"claimed" | "dry_run" | "sent" | "blocked" | "delivery_unknown">()
      .notNull(),
    providerMessageId: text("provider_message_id"),
    threadId: text("thread_id"),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    decisionTrace: jsonb("decision_trace_json").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("send_attempt_number_unique").on(table.outboundMessageId, table.attemptNumber),
    index("send_attempts_outbound_index").on(table.outboundMessageId, table.createdAt)
  ]
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventType: text("event_type").$type<"sequence.start" | "sequence.stop">().notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
    status: text("status")
      .$type<"pending" | "processing" | "processed" | "failed">()
      .default("pending")
      .notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("outbox_idempotency_unique").on(table.idempotencyKey),
    index("outbox_pending_index").on(table.status, table.availableAt)
  ]
);

export const gmailSyncCursors = pgTable("gmail_sync_cursors", {
  senderId: uuid("sender_id")
    .primaryKey()
    .references(() => senders.id, { onDelete: "restrict" }),
  historyId: text("history_id").notNull(),
  initializedAt: timestamp("initialized_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: updatedAt()
});

export const inboundMessages = pgTable(
  "inbound_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerMessageId: text("provider_message_id").notNull(),
    threadId: text("thread_id").notNull(),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => senders.id, { onDelete: "restrict" }),
    sequenceId: uuid("sequence_id")
      .notNull()
      .references(() => sequences.id, { onDelete: "restrict" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "restrict" }),
    associationType: text("association_type")
      .$type<"contact_reply" | "provider_bounce">()
      .notNull(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    bodyHash: text("body_hash").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    providerHeaders: jsonb("provider_headers_json").$type<Record<string, string>>().notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("inbound_provider_message_unique").on(table.providerMessageId),
    index("inbound_received_index").on(table.receivedAt),
    index("inbound_sequence_index").on(table.sequenceId, table.receivedAt)
  ]
);

export const replyClassificationsTable = pgTable(
  "reply_classifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    inboundMessageId: uuid("inbound_message_id")
      .notNull()
      .references(() => inboundMessages.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    classifierVersion: text("classifier_version").notNull(),
    classification: text("classification").$type<ReplyClassificationName>().notNull(),
    confidence: real("confidence").notNull(),
    sentiment: text("sentiment")
      .$type<"positive" | "neutral" | "negative" | "automated">()
      .notNull(),
    requestedAction: text("requested_action").$type<ReplyRequestedAction>().notNull(),
    suppressionRequired: boolean("suppression_required").notNull(),
    followUpDate: date("follow_up_date"),
    evidenceSnippets: jsonb("evidence_snippets_json").$type<readonly string[]>().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("reply_classification_version_unique").on(table.inboundMessageId, table.version),
    index("reply_classification_inbound_index").on(table.inboundMessageId, table.createdAt)
  ]
);

export const handoffs = pgTable(
  "handoffs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "restrict" }),
    replyId: uuid("reply_id")
      .notNull()
      .references(() => inboundMessages.id, { onDelete: "restrict" }),
    version: integer("version").default(1).notNull(),
    packet: jsonb("packet_json").$type<HandoffPacket>().notNull(),
    status: text("status").$type<"ready" | "owned">().default("ready").notNull(),
    createdBy: text("created_by").notNull(),
    ownedBy: text("owned_by"),
    ownedAt: timestamp("owned_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("handoff_reply_version_unique").on(table.replyId, table.version),
    index("handoffs_status_created_index").on(table.status, table.createdAt)
  ]
);

export const internalNotifications = pgTable(
  "internal_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: text("type").$type<"reply_needs_mateo">().notNull(),
    handoffId: uuid("handoff_id")
      .notNull()
      .references(() => handoffs.id, { onDelete: "restrict" }),
    recipient: text("recipient").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("notification_handoff_unique").on(table.handoffId),
    index("internal_notifications_unread_index").on(table.recipient, table.readAt, table.createdAt)
  ]
);

export const recheckTasks = pgTable(
  "recheck_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "restrict" }),
    inboundMessageId: uuid("inbound_message_id")
      .notNull()
      .references(() => inboundMessages.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: text("status")
      .$type<"pending" | "completed" | "cancelled">()
      .default("pending")
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("recheck_inbound_unique").on(table.inboundMessageId),
    index("recheck_tasks_pending_index").on(table.status, table.scheduledAt)
  ]
);
