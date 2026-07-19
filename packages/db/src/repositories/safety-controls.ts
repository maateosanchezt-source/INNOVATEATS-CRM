import { and, eq, isNull } from "drizzle-orm";

import type {
  FeatureFlagRecord,
  KillSwitchRecord,
  SafetyControlRepository
} from "@innovateats/feature-flags";
import {
  featureFlagKeySchema,
  killSwitchScopeTypeSchema,
  type FeatureFlagKey,
  type KillSwitchScope
} from "@innovateats/shared";

import type { AppDatabase } from "../client.js";
import { auditLog, featureFlags, killSwitches } from "../schema/index.js";

export interface AuditActor {
  readonly type: "human" | "system" | "agent";
  readonly id?: string;
}

export class PostgresSafetyControlRepository implements SafetyControlRepository {
  public constructor(private readonly database: AppDatabase) {}

  public async listFeatureFlags(): Promise<readonly FeatureFlagRecord[]> {
    const rows = await this.database
      .select({ key: featureFlags.key, enabled: featureFlags.enabled })
      .from(featureFlags);

    return rows.map((row) => ({
      key: featureFlagKeySchema.parse(row.key),
      enabled: row.enabled
    }));
  }

  public async listActiveKillSwitches(): Promise<readonly KillSwitchRecord[]> {
    const rows = await this.database
      .select()
      .from(killSwitches)
      .where(eq(killSwitches.active, true));

    return rows.map((row) => ({
      id: row.id,
      scope: {
        type: killSwitchScopeTypeSchema.parse(row.scopeType),
        ...(row.scopeId === null ? {} : { id: row.scopeId })
      },
      active: row.active,
      reason: row.reason
    }));
  }

  public async setFeatureFlag(
    key: FeatureFlagKey,
    enabled: boolean,
    actor: AuditActor
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(featureFlags)
        .where(eq(featureFlags.key, key))
        .limit(1);

      if (key === "global_dry_run" && !enabled) {
        const [emailFlag] = await transaction
          .select()
          .from(featureFlags)
          .where(eq(featureFlags.key, "email_send_enabled"))
          .limit(1);
        if (emailFlag?.enabled === true) {
          throw new Error("Cannot disable global dry-run while email sending is enabled.");
        }
      }

      await transaction
        .insert(featureFlags)
        .values({
          key,
          enabled,
          description: before?.description ?? key,
          riskTier: before?.riskTier ?? "high",
          updatedBy: actor.id ?? actor.type,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: featureFlags.key,
          set: {
            enabled,
            updatedBy: actor.id ?? actor.type,
            updatedAt: new Date()
          }
        });

      await transaction.insert(auditLog).values({
        actorType: actor.type,
        actorId: actor.id,
        action: "feature_flag.updated",
        entityType: "feature_flag",
        entityId: key,
        before: before === undefined ? null : { enabled: before.enabled },
        after: { enabled }
      });
    });
  }

  public async activateKillSwitch(
    scope: KillSwitchScope,
    reason: string,
    actor: AuditActor
  ): Promise<string> {
    return this.database.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(killSwitches)
        .values({
          scopeType: scope.type,
          scopeId: scope.id,
          reason,
          activatedBy: actor.id ?? actor.type
        })
        .returning({ id: killSwitches.id });

      if (created === undefined) {
        throw new Error("Kill switch activation returned no identifier.");
      }

      await transaction.insert(auditLog).values({
        actorType: actor.type,
        actorId: actor.id,
        action: "kill_switch.activated",
        entityType: "kill_switch",
        entityId: created.id,
        before: null,
        after: {
          scope,
          reason
        }
      });

      return created.id;
    });
  }

  public async releaseKillSwitch(scope: KillSwitchScope, actor: AuditActor): Promise<number> {
    return this.database.transaction(async (transaction) => {
      const condition =
        scope.id === undefined
          ? and(
              eq(killSwitches.scopeType, scope.type),
              isNull(killSwitches.scopeId),
              eq(killSwitches.active, true)
            )
          : and(
              eq(killSwitches.scopeType, scope.type),
              eq(killSwitches.scopeId, scope.id),
              eq(killSwitches.active, true)
            );

      const released = await transaction
        .update(killSwitches)
        .set({
          active: false,
          releasedBy: actor.id ?? actor.type,
          releasedAt: new Date(),
          updatedAt: new Date()
        })
        .where(condition)
        .returning({ id: killSwitches.id });

      for (const record of released) {
        await transaction.insert(auditLog).values({
          actorType: actor.type,
          actorId: actor.id,
          action: "kill_switch.released",
          entityType: "kill_switch",
          entityId: record.id,
          before: { active: true },
          after: { active: false }
        });
      }

      return released.length;
    });
  }
}
