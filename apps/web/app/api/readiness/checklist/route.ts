import { z } from "zod";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { readinessRepository } from "@/lib/runtime";

const reviewSchema = z.object({
  key: z.string().trim().min(1).max(100),
  status: z.enum(["unknown", "passed", "blocked"]),
  evidence: z.record(z.string(), z.unknown())
});

export async function GET(request: Request): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }
  try {
    return Response.json({ data: await readinessRepository().listChecklist() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }
  try {
    const input = reviewSchema.parse(await request.json());
    const item = await readinessRepository().reviewChecklistItem({
      ...input,
      actorId: actor
    });
    return Response.json({ data: item });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
