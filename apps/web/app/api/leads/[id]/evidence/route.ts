import { z } from "zod";

import { evidenceInputSchema, normalizePublicUrl } from "@innovateats/shared";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { crmRepository } from "@/lib/runtime";

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
    const input = evidenceInputSchema.parse(await request.json());
    normalizePublicUrl(input.sourceUrl);
    const created = await crmRepository().createEvidence(leadId, input, actor);
    return Response.json({ data: created }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
