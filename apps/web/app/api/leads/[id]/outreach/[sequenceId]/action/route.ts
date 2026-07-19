import { z } from "zod";

import {
  pauseOutreachSignal,
  resumeOutreachSignal,
  stopOutreachSignal
} from "@innovateats/workflows";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { outreachRepository, temporalClient } from "@/lib/runtime";

const actionSchema = z.object({
  action: z.enum(["pause", "resume", "cancel"])
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; sequenceId: string }> }
): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }
  try {
    const { id, sequenceId } = await context.params;
    const leadId = z.uuid().parse(id);
    z.uuid().parse(sequenceId);
    const input = actionSchema.parse(await request.json());
    const workspace = await outreachRepository().getWorkspace(leadId);
    const sequence = workspace.sequences.find((candidate) => candidate.id === sequenceId);
    if (sequence === undefined) {
      return Response.json(
        { error: { code: "not_found", message: "Sequence was not found for this lead." } },
        { status: 404 }
      );
    }

    const handle = (await temporalClient()).workflow.getHandle(sequence.workflowId);
    if (input.action === "pause") {
      await outreachRepository().setSequencePaused(sequenceId, true, actor);
      await handle.signal(pauseOutreachSignal);
    } else if (input.action === "resume") {
      await outreachRepository().setSequencePaused(sequenceId, false, actor);
      await handle.signal(resumeOutreachSignal);
    } else {
      await outreachRepository().stopSequence(sequenceId, "manual_cancel", actor);
      await handle.signal(stopOutreachSignal, "manual_cancel");
    }
    return Response.json({ data: { sequenceId, action: input.action } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
