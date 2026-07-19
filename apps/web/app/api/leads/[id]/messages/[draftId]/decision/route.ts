import { z } from "zod";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { messageRepository } from "@/lib/runtime";

const requestSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().min(1).max(500).nullable().default(null)
  })
  .superRefine((input, context) => {
    if (input.decision === "rejected" && input.reason === null) {
      context.addIssue({
        code: "custom",
        message: "A rejection requires a reason.",
        path: ["reason"]
      });
    }
  });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; draftId: string }> }
): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }

  try {
    const { id, draftId } = await context.params;
    const leadId = z.uuid().parse(id);
    const parsedDraftId = z.uuid().parse(draftId);
    const input = requestSchema.parse(await request.json());
    const result = await messageRepository().recordDecision(
      leadId,
      parsedDraftId,
      input.decision,
      input.reason,
      actor
    );
    return Response.json({ data: result }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
