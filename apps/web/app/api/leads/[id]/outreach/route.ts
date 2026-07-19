import { z } from "zod";

import { scheduleSequenceInputSchema } from "@innovateats/shared";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { evaluateSequenceSchedulingGate } from "@/lib/send-policy";
import { environment, outreachRepository, safetyControlService } from "@/lib/runtime";

const inputSchema = scheduleSequenceInputSchema.extend({
  contactId: z.uuid()
});

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
    const input = inputSchema.parse(await request.json());
    const config = environment();
    const gate = evaluateSequenceSchedulingGate(config, await safetyControlService().snapshot());
    if (!gate.allowed) {
      return Response.json(
        { error: { code: "send_gate_closed", message: gate.reason } },
        { status: 409 }
      );
    }
    const result = await outreachRepository().createSequence({
      leadId,
      contactId: input.contactId,
      campaignId: input.campaignId,
      senderId: input.senderId,
      recipientTimezone: input.timezone,
      deliveryMode: config.GMAIL_DELIVERY_MODE,
      actorId: actor
    });
    return Response.json({ data: result }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
