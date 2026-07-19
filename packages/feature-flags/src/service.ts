import {
  defaultFeatureFlags,
  normalizeFeatureFlags,
  type FeatureFlagKey,
  type KillSwitchScope
} from "@innovateats/shared";

export interface FeatureFlagRecord {
  readonly key: FeatureFlagKey;
  readonly enabled: boolean;
}

export interface KillSwitchRecord {
  readonly id: string;
  readonly scope: KillSwitchScope;
  readonly active: boolean;
  readonly reason: string;
}

export interface SafetyControlRepository {
  listFeatureFlags(): Promise<readonly FeatureFlagRecord[]>;
  listActiveKillSwitches(): Promise<readonly KillSwitchRecord[]>;
}

export interface SafetySnapshot {
  readonly flags: Readonly<Record<FeatureFlagKey, boolean>>;
  readonly activeKillSwitches: readonly KillSwitchRecord[];
  readonly globalKillSwitchActive: boolean;
}

export class SafetyControlService {
  public constructor(private readonly repository: SafetyControlRepository) {}

  public async snapshot(): Promise<SafetySnapshot> {
    const [records, activeKillSwitches] = await Promise.all([
      this.repository.listFeatureFlags(),
      this.repository.listActiveKillSwitches()
    ]);

    const configured = Object.fromEntries(
      records.map((record) => [record.key, record.enabled])
    ) as Partial<Record<FeatureFlagKey, boolean>>;
    const flags = normalizeFeatureFlags(configured);

    return {
      flags,
      activeKillSwitches,
      globalKillSwitchActive: activeKillSwitches.some(
        (killSwitch) => killSwitch.scope.type === "global"
      )
    };
  }

  public static safestPossibleSnapshot(): SafetySnapshot {
    return {
      flags: defaultFeatureFlags,
      activeKillSwitches: [
        {
          id: "fail-closed",
          scope: { type: "global" },
          active: true,
          reason: "Safety control storage unavailable"
        }
      ],
      globalKillSwitchActive: true
    };
  }
}
