import { z } from "zod";

import { outreachChannelSchema } from "@innovateats/shared";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { evaluateSocialManualGate } from "@/lib/social-policy";
import { complianceRepository, environment, safetyControlService } from "@/lib/runtime";

const manualChannelSchema = outreachChannelSchema.exclude(["email"]);
const createSchema = z.object({
  contactId: z.uuid(),
  campaignId: z.uuid(),
  channel: manualChannelSchema,
  requestedLanguage: z.enum(["en", "es"]).default("en"),
  reminderAt: z.iso.datetime({ offset: true }).optional()
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
    const input = createSchema.parse(await request.json());
    const config = environment();
    const gate = evaluateSocialManualGate(
      config.SOCIAL_MANUAL_QUEUE_ENABLED,
      await safetyControlService().snapshot()
    );
    if (!gate.allowed) {
      return Response.json(
        { error: { code: "social_manual_queue_disabled", message: gate.reason } },
        { status: 409 }
      );
    }
    const item = await complianceRepository().createSocialItem({
      leadId,
      contactId: input.contactId,
      campaignId: input.campaignId,
      channel: input.channel,
      requestedLanguage: input.requestedLanguage,
      businessPostalAddressConfigured: config.BUSINESS_POSTAL_ADDRESS !== undefined,
      actorId: actor,
      ...(input.reminderAt === undefined ? {} : { reminderAt: new Date(input.reminderAt) })
    });
    return Response.json({ data: item }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
