import { leadStatusSchema, manualLeadIngestSchema, normalizePublicUrl } from "@innovateats/shared";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { crmRepository } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }

  try {
    const url = new URL(request.url);
    const statusValue = url.searchParams.get("status");
    const status = statusValue === null ? undefined : leadStatusSchema.parse(statusValue);
    const search = url.searchParams.get("search") ?? undefined;
    const leads = await crmRepository().listLeads({
      ...(status === undefined ? {} : { status }),
      ...(search === undefined ? {} : { search })
    });
    return Response.json({ data: leads });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }

  try {
    const input = manualLeadIngestSchema.parse(await request.json());
    normalizePublicUrl(input.sourceUrl);
    const result = await crmRepository().ingestManualLead(input, actor);
    return Response.json(
      { data: result },
      {
        status: result.created ? 201 : 200,
        headers: { Location: `/leads/${result.leadId}` }
      }
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
