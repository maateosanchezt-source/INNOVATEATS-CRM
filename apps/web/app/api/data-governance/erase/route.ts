import { z } from "zod";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { dataGovernanceRepository } from "@/lib/runtime";

const erasureSchema = z
  .object({
    leadId: z.uuid(),
    confirmation: z.string().trim()
  })
  .superRefine((input, context) => {
    if (input.confirmation !== `ERASE ${input.leadId}`) {
      context.addIssue({
        code: "custom",
        path: ["confirmation"],
        message: `Confirmation must exactly equal ERASE ${input.leadId}.`
      });
    }
  });

export async function POST(request: Request): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }
  try {
    const input = erasureSchema.parse(await request.json());
    const result = await dataGovernanceRepository().eraseRejectedUncontactedLead(
      input.leadId,
      actor
    );
    return Response.json({ data: result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
