import { z } from "zod";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { inboundRepository } from "@/lib/runtime";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }
  try {
    const { id } = await context.params;
    const reply = await inboundRepository().getReply(z.uuid().parse(id));
    if (reply === null) {
      return Response.json(
        { error: { code: "not_found", message: "Reply was not found." } },
        { status: 404 }
      );
    }
    return Response.json({ data: reply });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
