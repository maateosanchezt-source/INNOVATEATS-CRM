import { z } from "zod";

import { scheduleSequenceInputSchema } from "@innovateats/shared";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { evaluateSequenceSchedulingGate } from "@/lib/send-policy";
import {
  complianceRepository,
  environment,
  outreachRepository,
  safetyControlService
} from "@/lib/runtime";

const inputSchema = scheduleSequenceInputSchema.extend({
  contactId: z.uuid(),
  requestedLanguage: z.enum(["en", "es"]).default("en")
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
    const compliance = await complianceRepository().createDecision({
      leadId,
      contactId: input.contactId,
      campaignId: input.campaignId,
      channel: "email",
      requestedLanguage: input.requestedLanguage,
      businessPostalAddressConfigured: config.BUSINESS_POSTAL_ADDRESS !== undefined,
      actorId: actor
    });
    if (compliance.result.decision === "block") {
      return Response.json(
        {
          error: {
            code: "compliance_block",
            message: compliance.result.reasons.join(" ")
          },
          data: { compliance }
        },
        { status: 409 }
      );
    }
    if (
      config.GMAIL_DELIVERY_MODE !== "dry_run" &&
      !["allow", "approval_required"].includes(compliance.result.decision)
    ) {
      return Response.json(
        {
          error: {
            code: "external_delivery_not_permitted",
            message: compliance.result.reasons.join(" ")
          },
          data: { compliance }
        },
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
      complianceDecisionId: compliance.id,
      actorId: actor
    });
    return Response.json({ data: { sequence: result, compliance } }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
