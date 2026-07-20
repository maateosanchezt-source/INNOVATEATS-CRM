import { createDiscoveryCampaignSchema } from "@innovateats/shared";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { discoveryRepository, environment } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }
  try {
    return Response.json({ data: await discoveryRepository().listCampaigns() });
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
    if (!environment().DISCOVERY_ENABLED) {
      return Response.json(
        {
          error: {
            code: "discovery_disabled",
            message: "Instagram discovery is disabled in this environment."
          }
        },
        { status: 409 }
      );
    }
    const input = createDiscoveryCampaignSchema.parse(await request.json());
    const campaign = await discoveryRepository().createCampaign(input, actor);
    return Response.json({ data: campaign }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
