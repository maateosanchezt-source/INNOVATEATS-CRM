import { pilotEvalSuiteVersion, runPilotEvalSuite } from "@innovateats/evals";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { readinessRepository } from "@/lib/runtime";

function jsonRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export async function POST(request: Request): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }
  try {
    const report = runPilotEvalSuite();
    const repository = readinessRepository();
    const [evalRun, pilot] = await Promise.all([
      repository.recordEvalReport({
        suiteVersion: pilotEvalSuiteVersion,
        datasetVersion: report.datasetVersion,
        ...(process.env.GITHUB_SHA === undefined ? {} : { commitSha: process.env.GITHUB_SHA }),
        report: jsonRecord(report),
        automatedPassed: report.automatedPassed,
        pilotReady: report.pilotReady,
        actorId: actor
      }),
      repository.ensureSimulationPilotPlan(actor)
    ]);
    return Response.json({ data: { evalRun, pilot, report } }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
