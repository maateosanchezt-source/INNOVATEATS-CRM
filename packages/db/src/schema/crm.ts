import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

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
    uniqueIndex("source_documents_canonical_url_unique").on(table.canonicalUrl),
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
