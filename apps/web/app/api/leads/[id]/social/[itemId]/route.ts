import { z } from "zod";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { complianceRepository } from "@/lib/runtime";

const actionSchema = z.object({
  action: z.enum(["copied", "marked_sent", "cancelled"])
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; itemId: string }> }
): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }
  try {
    const { id, itemId } = await context.params;
    const leadId = z.uuid().parse(id);
    const parsedItemId = z.uuid().parse(itemId);
    const input = actionSchema.parse(await request.json());
    const item = await complianceRepository().transitionSocialItem(
      leadId,
      parsedItemId,
      input.action,
      actor
    );
    return Response.json({ data: item });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
