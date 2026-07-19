import { z } from "zod";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { inboundRepository } from "@/lib/runtime";

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
    const replyId = z.uuid().parse(id);
    await inboundRepository().markOwned(replyId, actor);
    return Response.json({ data: { replyId, status: "owned" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
