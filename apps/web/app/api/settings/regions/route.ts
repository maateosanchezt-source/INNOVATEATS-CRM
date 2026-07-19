import { z } from "zod";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { complianceRepository } from "@/lib/runtime";

const updateSchema = z
  .object({
    code: z.string().trim().min(2).max(30),
    enabled: z.boolean(),
    confirmCode: z.string().trim().min(2).max(30)
  })
  .superRefine((value, context) => {
    if (value.code.toUpperCase() !== value.confirmCode.toUpperCase()) {
      context.addIssue({
        code: "custom",
        message: "The region code confirmation does not match.",
        path: ["confirmCode"]
      });
    }
  });

export async function GET(request: Request): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }
  try {
    return Response.json({ data: await complianceRepository().listRegionPolicies() });
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
    const input = updateSchema.parse(await request.json());
    const region = await complianceRepository().setRegionEnabled(input.code, input.enabled, actor);
    return Response.json({ data: region });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
