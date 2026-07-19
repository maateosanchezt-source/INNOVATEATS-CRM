import { z } from "zod";

import { evidenceInputSchema, normalizePublicUrl } from "@innovateats/shared";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { crmRepository } from "@/lib/runtime";

const parametersSchema = z.object({
  id: z.uuid(),
  evidenceId: z.uuid()
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; evidenceId: string }> }
): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }

  try {
    const parameters = parametersSchema.parse(await context.params);
    const input = evidenceInputSchema.parse(await request.json());
    normalizePublicUrl(input.sourceUrl);
    const revised = await crmRepository().reviseEvidence(
      parameters.id,
      parameters.evidenceId,
      input,
      actor
    );
    return Response.json({ data: revised });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; evidenceId: string }> }
): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }

  try {
    const parameters = parametersSchema.parse(await context.params);
    await crmRepository().deleteEvidence(parameters.id, parameters.evidenceId, actor);
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
