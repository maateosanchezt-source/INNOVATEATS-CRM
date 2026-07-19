import { describe, expect, it } from "vitest";

import { runtimeBlockReason, type RuntimeSendGate } from "../../src/repositories/outreach.js";

function gate(overrides: Partial<RuntimeSendGate> = {}): RuntimeSendGate {
  return {
    configuredMode: "production",
    environmentDryRun: false,
    environmentEmailSendEnabled: true,
    productionSendApproved: true,
    sandboxSendApproved: false,
    authorizedEmail: "maateosanchezt@gmail.com",
    sandboxRecipient: "maateosanchezt@gmail.com",
    businessContactEmail: "maateosanchezt@gmail.com",
    businessPostalAddress: "Reviewed postal address",
    globalDailyCap: 10,
    pilotMode: true,
    pilotTargetLeads: 50,
    pilotHumanApprovalRequired: true,
    externalIntegrationConfigured: true,
    ...overrides
  };
}

describe("production pilot runtime gate", () => {
  it("allows production only inside the explicit human-approved pilot envelope", () => {
    expect(runtimeBlockReason("production", gate())).toBeNull();
    expect(runtimeBlockReason("production", gate({ pilotMode: false }))).toMatch(
      /controlled pilot/u
    );
    expect(runtimeBlockReason("production", gate({ pilotHumanApprovalRequired: false }))).toMatch(
      /100% human approval/u
    );
    expect(runtimeBlockReason("production", gate({ productionSendApproved: false }))).toMatch(
      /explicit go-live approval/u
    );
  });

  it("keeps dry-run independent from production authorization", () => {
    expect(
      runtimeBlockReason(
        "dry_run",
        gate({
          configuredMode: "dry_run",
          environmentDryRun: true,
          productionSendApproved: false,
          pilotMode: false
        })
      )
    ).toBeNull();
  });
});
