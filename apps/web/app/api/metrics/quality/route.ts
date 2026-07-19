import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { metricsRepository } from "@/lib/runtime";

export async function GET(request: Request): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }
  try {
    return Response.json({ data: await metricsRepository().quality() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
