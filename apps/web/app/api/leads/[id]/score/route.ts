import { z } from "zod";

import { scoreIcpAssessment } from "@innovateats/agents";
import { icpAssessmentInputSchema } from "@innovateats/shared";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { evaluateResearchGate } from "@/lib/research-policy";
import { environment, researchRepository, safetyControlService } from "@/lib/runtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }

  try {
    const { id } = await context.params;
    const leadId = z.uuid().parse(id);
    const assessment = icpAssessmentInputSchema.parse(await request.json());
    const gate = evaluateResearchGate(
      environment().RESEARCH_ENABLED,
      await safetyControlService().snapshot()
    );
    if (!gate.allowed) {
      return Response.json(
        { error: { code: "research_disabled", message: gate.reason } },
        { status: 409 }
      );
    }
    const score = scoreIcpAssessment(assessment);
    const created = await researchRepository().saveLeadScore(leadId, score, actor);
    return Response.json({ data: created }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
