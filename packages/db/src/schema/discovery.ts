import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

import type {
  DiscoveryCampaignStatus,
  DiscoveryCandidateStatus,
  DiscoveryRunStatus,
  DiscoveryRunTrigger,
  DiscoverySeedKind,
  DiscoveryTrack,
  InstagramProfileSnapshot
} from "@innovateats/shared";

import { leads } from "./crm.js";
import { regions } from "./foundations.js";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const discoveryCampaigns = pgTable(
  "discovery_campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    regionId: uuid("region_id")
      .notNull()
      .references(() => regions.id, { onDelete: "restrict" }),
    status: text("status").$type<DiscoveryCampaignStatus>().default("active").notNull(),
    targetCandidates: integer("target_candidates").default(500).notNull(),
    dailyCandidateCap: integer("daily_candidate_cap").default(100).notNull(),
    resultsPerSeed: integer("results_per_seed").default(25).notNull(),
    minFollowers: integer("min_followers").default(50).notNull(),
    maxFollowers: integer("max_followers").default(50_000).notNull(),
    activeWithinDays: integer("active_within_days").default(90).notNull(),
    scheduleIntervalHours: integer("schedule_interval_hours").default(24).notNull(),
    autoSchedule: boolean("auto_schedule").default(false).notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("discovery_campaign_name_unique").on(table.name),
    index("discovery_campaign_due_index").on(table.status, table.autoSchedule, table.nextRunAt),
    index("discovery_campaign_region_index").on(table.regionId)
  ]
);

export const discoverySeeds = pgTable(
  "discovery_seeds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => discoveryCampaigns.id, { onDelete: "restrict" }),
    kind: text("kind").$type<DiscoverySeedKind>().notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    track: text("track").$type<DiscoveryTrack>().notNull(),
    priority: integer("priority").default(50).notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: createdAt()
  },
  (table) => [
    uniqueIndex("discovery_seed_campaign_unique").on(
      table.campaignId,
      table.kind,
      table.track,
      table.normalizedValue
    ),
    index("discovery_seed_campaign_active_index").on(table.campaignId, table.active, table.priority)
  ]
);

export const discoveryRuns = pgTable(
  "discovery_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => discoveryCampaigns.id, { onDelete: "restrict" }),
    workflowId: text("workflow_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    trigger: text("trigger").$type<DiscoveryRunTrigger>().notNull(),
    status: text("status").$type<DiscoveryRunStatus>().default("queued").notNull(),
    discoveredCount: integer("discovered_count").default(0).notNull(),
    enrichedCount: integer("enriched_count").default(0).notNull(),
    acceptedCount: integer("accepted_count").default(0).notNull(),
    rejectedCount: integer("rejected_count").default(0).notNull(),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 })
      .default("0")
      .notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    queuedBy: text("queued_by").notNull(),
    queuedAt: timestamp("queued_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("discovery_run_workflow_unique").on(table.workflowId),
    uniqueIndex("discovery_run_idempotency_unique").on(table.idempotencyKey),
    index("discovery_run_status_queue_index").on(table.status, table.queuedAt),
    index("discovery_run_campaign_index").on(table.campaignId, table.queuedAt)
  ]
);

export const discoveryProviderActions = pgTable(
  "discovery_provider_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => discoveryRuns.id, { onDelete: "restrict" }),
    seedId: uuid("seed_id").references(() => discoverySeeds.id, { onDelete: "restrict" }),
    actionKey: text("action_key").notNull(),
    provider: text("provider").notNull(),
    actorId: text("actor_id").notNull(),
    inputHash: text("input_hash").notNull(),
    status: text("status").default("claimed").notNull(),
    providerRunId: text("provider_run_id"),
    datasetId: text("dataset_id"),
    itemCount: integer("item_count").default(0).notNull(),
    errorCode: text("error_code"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("discovery_provider_action_key_unique").on(table.actionKey),
    uniqueIndex("discovery_provider_run_unique")
      .on(table.provider, table.providerRunId)
      .where(sql`${table.providerRunId} IS NOT NULL`),
    index("discovery_provider_action_run_index").on(table.runId, table.status)
  ]
);

export const discoveryCandidates = pgTable(
  "discovery_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => discoveryCampaigns.id, { onDelete: "restrict" }),
    firstRunId: uuid("first_run_id")
      .notNull()
      .references(() => discoveryRuns.id, { onDelete: "restrict" }),
    username: text("username").notNull(),
    profileUrl: text("profile_url").notNull(),
    fullName: text("full_name"),
    biography: text("biography"),
    externalUrl: text("external_url"),
    followersCount: integer("followers_count"),
    followsCount: integer("follows_count"),
    postsCount: integer("posts_count"),
    isBusinessAccount: boolean("is_business_account"),
    isPrivate: boolean("is_private").default(false).notNull(),
    isVerified: boolean("is_verified").default(false).notNull(),
    businessCategory: text("business_category"),
    track: text("track").$type<DiscoveryTrack>().notNull(),
    country: text("country").default("Spain").notNull(),
    latestPostAt: timestamp("latest_post_at", { withTimezone: true }),
    snapshot: jsonb("snapshot_json").$type<InstagramProfileSnapshot>().notNull(),
    status: text("status").$type<DiscoveryCandidateStatus>().default("needs_review").notNull(),
    filterReasons: jsonb("filter_reasons_json").$type<readonly string[]>().default([]).notNull(),
    decisionReason: text("decision_reason"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "restrict" }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (table) => [
    uniqueIndex("discovery_candidate_campaign_username_unique").on(
      table.campaignId,
      table.username
    ),
    index("discovery_candidate_status_index").on(table.campaignId, table.status, table.lastSeenAt),
    index("discovery_candidate_track_index").on(table.track, table.status),
    index("discovery_candidate_lead_index").on(table.leadId)
  ]
);

export const discoveryCandidateSources = pgTable(
  "discovery_candidate_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => discoveryCandidates.id, { onDelete: "restrict" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => discoveryRuns.id, { onDelete: "restrict" }),
    seedId: uuid("seed_id")
      .notNull()
      .references(() => discoverySeeds.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerResultId: text("provider_result_id").notNull(),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("discovery_candidate_source_unique").on(
      table.candidateId,
      table.runId,
      table.seedId
    ),
    index("discovery_candidate_source_candidate_index").on(table.candidateId, table.discoveredAt)
  ]
);
