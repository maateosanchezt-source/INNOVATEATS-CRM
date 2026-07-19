import { z } from "zod";

import { extractPublicContacts } from "@innovateats/agents";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { evaluateContactGate } from "@/lib/contact-policy";
import { contactRepository, environment, safetyControlService } from "@/lib/runtime";

const requestSchema = z.object({ evidenceId: z.uuid() });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }

  try {
    const { id } = await context.params;
    const leadId = z.uuid().parse(id);
    const input = requestSchema.parse(await request.json());
    const gate = evaluateContactGate(
      environment().CONTACT_ENRICHMENT_ENABLED,
      await safetyControlService().snapshot()
    );
    if (!gate.allowed) {
      return Response.json(
        { error: { code: "contact_enrichment_disabled", message: gate.reason } },
        { status: 409 }
      );
    }

    const repository = contactRepository();
    const source = await repository.getExtractionSource(leadId, input.evidenceId);
    const research = extractPublicContacts(source);
    const saved = await repository.saveCandidates(leadId, research.contacts, actor);
    return Response.json({ data: { ...saved, warnings: research.warnings } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
