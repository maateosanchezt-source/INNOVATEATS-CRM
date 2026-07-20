import { discoveryCandidateDecisionSchema } from "@innovateats/shared";
import { z } from "zod";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { discoveryRepository } from "@/lib/runtime";

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> }
): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }
  try {
    const { id } = await context.params;
    const candidateId = z.uuid().parse(id);
    const decision = discoveryCandidateDecisionSchema.parse(await request.json());
    await discoveryRepository().decideCandidate(candidateId, decision, actor);
    return Response.json({ data: { candidateId, status: decision.decision } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
