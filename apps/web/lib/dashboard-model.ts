import type { SafetySnapshot } from "@innovateats/feature-flags";

export interface DashboardModel {
  readonly status: "safe" | "halted";
  readonly banner: string;
  readonly cards: readonly {
    readonly label: string;
    readonly value: string;
    readonly tone: "safe" | "warning" | "neutral";
  }[];
}

export function buildDashboardModel(snapshot: SafetySnapshot): DashboardModel {
  const halted = snapshot.globalKillSwitchActive;

  return {
    status: halted ? "halted" : "safe",
    banner: halted
      ? "Global kill switch active — external actions are halted."
      : snapshot.flags.global_dry_run
        ? "DRY RUN — no external messages can be sent."
        : "Dry run is disabled. Review every remaining outbound gate.",
    cards: [
      {
        label: "Global dry run",
        value: snapshot.flags.global_dry_run ? "ON" : "OFF",
        tone: snapshot.flags.global_dry_run ? "safe" : "warning"
      },
      {
        label: "Email sending",
        value: snapshot.flags.email_send_enabled ? "ENABLED" : "DISABLED",
        tone: snapshot.flags.email_send_enabled ? "warning" : "safe"
      },
      {
        label: "Autonomous sending",
        value: snapshot.flags.autonomous_send_enabled ? "ENABLED" : "DISABLED",
        tone: snapshot.flags.autonomous_send_enabled ? "warning" : "safe"
      },
      {
        label: "Kill switches",
        value: String(snapshot.activeKillSwitches.length),
        tone: halted ? "warning" : "neutral"
      }
    ]
  };
}
