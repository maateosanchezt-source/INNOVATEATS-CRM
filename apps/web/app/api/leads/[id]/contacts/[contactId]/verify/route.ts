import { z } from "zod";

import { verifyBusinessEmail } from "@innovateats/integrations";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { evaluateContactGate } from "@/lib/contact-policy";
import {
  contactRepository,
  emailVerificationProvider,
  environment,
  mxResolver,
  safetyControlService
} from "@/lib/runtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; contactId: string }> }
): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }

  try {
    const { id, contactId } = await context.params;
    const leadId = z.uuid().parse(id);
    const parsedContactId = z.uuid().parse(contactId);
    const gate = evaluateContactGate(
      environment().CONTACT_ENRICHMENT_ENABLED,
      await safetyControlService().snapshot(),
      "email_verifier"
    );
    if (!gate.allowed) {
      return Response.json(
        { error: { code: "contact_enrichment_disabled", message: gate.reason } },
        { status: 409 }
      );
    }

    const repository = contactRepository();
    const contact = await repository.getForVerification(leadId, parsedContactId);
    const result = await verifyBusinessEmail(
      contact.value,
      mxResolver(),
      emailVerificationProvider(),
      { origin: contact.origin }
    );
    const updated = await repository.recordVerification(leadId, parsedContactId, result, actor);
    return Response.json({ data: { contact: updated, verification: result } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
