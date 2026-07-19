import { z } from "zod";

import { leadUpdateSchema } from "@innovateats/shared";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { crmRepository } from "@/lib/runtime";

const identifierSchema = z.uuid();

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
    const lead = await crmRepository().getLead(identifierSchema.parse(id));
    if (lead === null) {
      return Response.json(
        { error: { code: "not_found", message: "Lead not found." } },
        { status: 404 }
      );
    }
    return Response.json({ data: lead });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }

  try {
    const { id } = await context.params;
    const input = leadUpdateSchema.parse(await request.json());
    const lead = await crmRepository().updateLead(identifierSchema.parse(id), input, actor);
    return Response.json({ data: lead });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
