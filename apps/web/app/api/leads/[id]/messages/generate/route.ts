import { z } from "zod";

import { buildMessageSequence, reviewMessageDraft } from "@innovateats/agents";
import { messageBriefSchema } from "@innovateats/shared";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { evaluateMessageGenerationGate } from "@/lib/message-policy";
import { environment, messageRepository, safetyControlService } from "@/lib/runtime";

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
    const brief = messageBriefSchema.parse(await request.json());
    const gate = evaluateMessageGenerationGate(
      environment().MESSAGE_GENERATION_ENABLED,
      await safetyControlService().snapshot(),
      "message_strategy"
    );
    if (!gate.allowed) {
      return Response.json(
        { error: { code: "message_generation_disabled", message: gate.reason } },
        { status: 409 }
      );
    }

    const sequence = buildMessageSequence(brief);
    const reviews = sequence.drafts.map((draft) => reviewMessageDraft(draft, brief.evidenceIds));
    const result = await messageRepository().saveGeneratedSequence(
      leadId,
      brief,
      sequence,
      reviews,
      actor
    );
    return Response.json({ data: result }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
