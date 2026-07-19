import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { dataGovernanceRepository } from "@/lib/runtime";

export async function GET(request: Request): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }
  try {
    const bundle = await dataGovernanceRepository().exportOwnedData(actor);
    return new Response(JSON.stringify(bundle, null, 2), {
      headers: {
        "content-disposition": `attachment; filename="innovateats-crm-export-${bundle.generatedAt.slice(0, 10)}.json"`,
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
