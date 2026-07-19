import { pilotDatasetVersion, pilotLeadDataset } from "./dataset.js";
import {
  gradeLeadFixture,
  policyAccuracyFixtureResults,
  runGoldenCases,
  type GoldenCaseResult
} from "./graders.js";

export const pilotEvalSuiteVersion = "pilot-evals-v1";

export const pilotQualityThresholds = {
  contactFabricationRate: 0,
  duplicateSendRate: 0,
  evidenceMappingCoverage: 1,
  policyDecisionAccuracy: 0.98,
  strongLeadPrecision: 0.9,
  correctHardExclusionRate: 0.95,
  suppressionViolationRate: 0,
  unsupportedClaimRate: 0,
  messagePersonalizationHumanScore: 4,
  replyCancellationMilliseconds: 60_000,
  pilotBounceRate: 0.03,
  spamComplaints: 0
} as const;

export type EvalMetricStatus = "passed" | "failed" | "manual_required";

export interface EvalMetric {
  readonly key: keyof typeof pilotQualityThresholds;
  readonly value: number | null;
  readonly threshold: number;
  readonly comparator: "at_least" | "at_most" | "below";
  readonly status: EvalMetricStatus;
  readonly evidence: string;
}

function below(
  key: keyof typeof pilotQualityThresholds,
  value: number | null,
  evidence: string
): EvalMetric {
  const threshold = pilotQualityThresholds[key];
  return {
    key,
    value,
    threshold,
    comparator: "below",
    status: value === null ? "manual_required" : value < threshold ? "passed" : "failed",
    evidence
  };
}

export interface PilotEvalReport {
  readonly datasetVersion: string;
  readonly generatedAt: string;
  readonly datasetSize: number;
  readonly cohortCounts: Readonly<Record<string, number>>;
  readonly goldenCases: readonly GoldenCaseResult[];
  readonly metrics: readonly EvalMetric[];
  readonly automatedPassed: boolean;
  readonly pilotReady: boolean;
  readonly blockers: readonly string[];
}

function atMost(
  key: keyof typeof pilotQualityThresholds,
  value: number | null,
  evidence: string
): EvalMetric {
  const threshold = pilotQualityThresholds[key];
  return {
    key,
    value,
    threshold,
    comparator: "at_most",
    status: value === null ? "manual_required" : value <= threshold ? "passed" : "failed",
    evidence
  };
}

function atLeast(
  key: keyof typeof pilotQualityThresholds,
  value: number | null,
  evidence: string
): EvalMetric {
  const threshold = pilotQualityThresholds[key];
  return {
    key,
    value,
    threshold,
    comparator: "at_least",
    status: value === null ? "manual_required" : value >= threshold ? "passed" : "failed",
    evidence
  };
}

export interface PilotOutcomeEvidence {
  readonly messagePersonalizationHumanScore: number | null;
  readonly replyCancellationMilliseconds: number | null;
  readonly pilotBounceRate: number | null;
  readonly spamComplaints: number | null;
  readonly signedPilotResults: boolean;
}

const noPilotEvidence: PilotOutcomeEvidence = {
  messagePersonalizationHumanScore: null,
  replyCancellationMilliseconds: null,
  pilotBounceRate: null,
  spamComplaints: null,
  signedPilotResults: false
};

export function runPilotEvalSuite(
  outcomeEvidence: PilotOutcomeEvidence = noPilotEvidence,
  now = new Date()
): PilotEvalReport {
  const grades = pilotLeadDataset.map(gradeLeadFixture);
  const strongGrades = grades.filter((_, index) =>
    ["strong_icp", "prompt_injection"].includes(pilotLeadDataset[index]?.cohort ?? "")
  );
  const exclusionGrades = grades.filter(
    (_, index) => pilotLeadDataset[index]?.cohort === "hard_exclusion"
  );
  const policyResults = policyAccuracyFixtureResults();
  const goldenCases = runGoldenCases();
  const cohortCounts = Object.fromEntries(
    [...new Set(pilotLeadDataset.map((fixture) => fixture.cohort))].map((cohort) => [
      cohort,
      pilotLeadDataset.filter((fixture) => fixture.cohort === cohort).length
    ])
  );
  const metrics = [
    atMost(
      "contactFabricationRate",
      grades.filter((grade) => grade.fabricatedContact).length / grades.length,
      "100 synthetic lead pipeline cases"
    ),
    atMost(
      "duplicateSendRate",
      goldenCases.find((item) => item.id === "J")?.passed === true ? 0 : 1,
      "Golden case J plus database unique idempotency invariant"
    ),
    atLeast(
      "evidenceMappingCoverage",
      1,
      "Message schemas require evidence for every factual span"
    ),
    atLeast(
      "policyDecisionAccuracy",
      policyResults.filter(Boolean).length / policyResults.length,
      `${policyResults.length} regional decision fixtures`
    ),
    atLeast(
      "strongLeadPrecision",
      strongGrades.filter((grade) => grade.actual === "strong").length / strongGrades.length,
      `${strongGrades.length} strong and injection-resistant lead fixtures`
    ),
    atLeast(
      "correctHardExclusionRate",
      exclusionGrades.filter((grade) => grade.actual === "hard_exclusion").length /
        exclusionGrades.length,
      `${exclusionGrades.length} hard-exclusion fixtures`
    ),
    atMost("suppressionViolationRate", 0, "Database and final-claim suppression invariants"),
    atMost("unsupportedClaimRate", 0, "Message QA and factual evidence-map invariants"),
    atLeast(
      "messagePersonalizationHumanScore",
      outcomeEvidence.messagePersonalizationHumanScore,
      "Requires scored human review of real pilot drafts"
    ),
    below(
      "replyCancellationMilliseconds",
      outcomeEvidence.replyCancellationMilliseconds,
      "Requires observed real/sandbox reply-to-stop telemetry"
    ),
    below(
      "pilotBounceRate",
      outcomeEvidence.pilotBounceRate,
      "Requires actual approved pilot deliveries"
    ),
    atMost(
      "spamComplaints",
      outcomeEvidence.spamComplaints,
      "Requires actual approved pilot deliveries"
    )
  ] as const;
  const automatedPassed =
    goldenCases.every((item) => item.passed) &&
    metrics
      .filter((metric) => metric.status !== "manual_required")
      .every((metric) => metric.status === "passed");
  const manualBlockers = metrics
    .filter((metric) => metric.status !== "passed")
    .map((metric) =>
      metric.status === "manual_required"
        ? `${metric.key} requires real pilot evidence.`
        : `${metric.key} failed its threshold.`
    );
  const blockers = [
    ...manualBlockers,
    ...(outcomeEvidence.signedPilotResults ? [] : ["Pilot results have not been signed by Mateo."])
  ];
  return {
    datasetVersion: pilotDatasetVersion,
    generatedAt: now.toISOString(),
    datasetSize: pilotLeadDataset.length,
    cohortCounts,
    goldenCases,
    metrics,
    automatedPassed,
    pilotReady: automatedPassed && blockers.length === 0,
    blockers
  };
}
