import { z } from "zod";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { evaluateResearchGate } from "@/lib/research-policy";
import {
  environment,
  researchRepository,
  safetyControlService,
  securePublicFetcher
} from "@/lib/runtime";

const requestSchema = z.object({
  sourceUrl: z.string().trim().min(1).max(2_048)
});

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
    const input = requestSchema.parse(await request.json());
    const safety = await safetyControlService().snapshot();
    const gate = evaluateResearchGate(environment().RESEARCH_ENABLED, safety, "secure_fetch");
    if (!gate.allowed) {
      return Response.json(
        { error: { code: "research_disabled", message: gate.reason } },
        { status: 409 }
      );
    }

    const snapshot = await securePublicFetcher().fetch(input.sourceUrl);
    const result = await researchRepository().recordSourceSnapshot(leadId, snapshot, actor);
    return Response.json({ data: result }, { status: result.captured ? 201 : 200 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
