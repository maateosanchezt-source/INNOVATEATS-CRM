import {
  bigserial,
  boolean,
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
  EmailProviderVerdict,
  IcpDimensionKey,
  IcpRecommendedAction,
  IcpScoreBreakdown
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
