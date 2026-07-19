import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").default(false).notNull(),
  description: text("description").notNull(),
  riskTier: text("risk_tier").default("high").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

export const killSwitches = pgTable(
  "kill_switches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id"),
    active: boolean("active").default(true).notNull(),
    reason: text("reason").notNull(),
    activatedBy: text("activated_by").notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }).defaultNow().notNull(),
    releasedBy: text("released_by"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index("kill_switch_scope_index").on(table.scopeType, table.scopeId),
    index("kill_switch_active_index").on(table.active)
  ]
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before_json").$type<Record<string, unknown> | null>(),
    after: jsonb("after_json").$type<Record<string, unknown> | null>(),
    metadata: jsonb("metadata_json").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index("audit_log_entity_index").on(table.entityType, table.entityId),
    index("audit_log_created_at_index").on(table.createdAt)
  ]
);

export const regions = pgTable(
  "regions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    timezoneStrategy: text("timezone_strategy").default("recipient_local").notNull(),
    defaultLanguage: text("default_language").default("en").notNull(),
    policyMode: text("policy_mode").notNull(),
    enabled: boolean("enabled").default(false).notNull(),
    policyVersion: integer("policy_version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [uniqueIndex("regions_code_unique").on(table.code)]
);

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value_json").$type<unknown>().notNull(),
  sensitive: boolean("sensitive").default(false).notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

export const schemaMigrations = pgTable("schema_migrations", {
  name: text("name").primaryKey(),
  checksum: text("checksum").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull()
});
