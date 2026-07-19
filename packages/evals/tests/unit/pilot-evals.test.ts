import { describe, expect, it } from "vitest";

import {
  pilotLeadDataset,
  policyAccuracyFixtureResults,
  runGoldenCases,
  runPilotEvalSuite
} from "../../src/index.js";

describe("Phase 8 pilot eval suite", () => {
  it("contains the required 100-lead regional dataset distribution", () => {
    expect(pilotLeadDataset).toHaveLength(100);
    expect(
      Object.fromEntries(
        [...new Set(pilotLeadDataset.map((item) => item.cohort))].map((cohort) => [
          cohort,
          pilotLeadDataset.filter((item) => item.cohort === cohort).length
        ])
      )
    ).toEqual({
      strong_icp: 30,
      borderline: 20,
      hard_exclusion: 20,
      duplicate: 10,
      prompt_injection: 10,
      ambiguous_contact: 10
    });
    expect(new Set(pilotLeadDataset.map((item) => item.regionCode)).size).toBe(6);
  });

  it("passes golden cases A through J", () => {
    const results = runGoldenCases();
    expect(results.map((result) => result.id)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J"
    ]);
    expect(results.filter((result) => !result.passed)).toEqual([]);
  });

  it("exceeds the 98% regional policy target without masking manual evidence", () => {
    const decisions = policyAccuracyFixtureResults();
    expect(decisions).toHaveLength(50);
    expect(decisions.filter(Boolean).length / decisions.length).toBeGreaterThanOrEqual(0.98);

    const report = runPilotEvalSuite(undefined, new Date("2026-07-19T12:00:00.000Z"));
    expect(report.automatedPassed).toBe(true);
    expect(report.pilotReady).toBe(false);
    expect(report.blockers).toContain("Pilot results have not been signed by Mateo.");
    expect(report.metrics.filter((metric) => metric.status === "manual_required")).toHaveLength(4);
  });

  it("becomes pilot-ready only when every real-world threshold and signature are supplied", () => {
    const report = runPilotEvalSuite(
      {
        messagePersonalizationHumanScore: 4.4,
        replyCancellationMilliseconds: 30_000,
        pilotBounceRate: 0.02,
        spamComplaints: 0,
        signedPilotResults: true
      },
      new Date("2026-07-19T12:00:00.000Z")
    );
    expect(report.pilotReady).toBe(true);
    expect(report.blockers).toEqual([]);
  });

  it("treats the reply and bounce limits as strict upper bounds", () => {
    const report = runPilotEvalSuite({
      messagePersonalizationHumanScore: 4,
      replyCancellationMilliseconds: 60_000,
      pilotBounceRate: 0.03,
      spamComplaints: 0,
      signedPilotResults: true
    });
    expect(
      report.metrics.find((metric) => metric.key === "replyCancellationMilliseconds")?.status
    ).toBe("failed");
    expect(report.metrics.find((metric) => metric.key === "pilotBounceRate")?.status).toBe(
      "failed"
    );
    expect(report.pilotReady).toBe(false);
  });
});
