import { z } from "zod";

import { decideEntityResolution } from "@innovateats/agents";
import { entityResolutionProposalSchema } from "@innovateats/shared";

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
    const proposal = entityResolutionProposalSchema.parse(await request.json());
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
    const decision = decideEntityResolution(proposal);
    const result = await researchRepository().applyEntityResolution(leadId, decision, actor);
    return Response.json({ data: { decision, result } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
