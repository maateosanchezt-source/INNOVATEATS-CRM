import { z } from "zod";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { discoveryRepository, environment } from "@/lib/runtime";

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> }
): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }
  try {
    if (!environment().DISCOVERY_ENABLED) {
      return Response.json(
        { error: { code: "discovery_disabled", message: "Instagram discovery is disabled." } },
        { status: 409 }
      );
    }
    const { id } = await context.params;
    const campaignId = z.uuid().parse(id);
    const run = await discoveryRepository().queueRun(campaignId, "manual", actor);
    return Response.json({ data: run }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
