import { z } from "zod";

import { remapHumanEditEvidence, reviewMessageDraft } from "@innovateats/agents";
import { countMessageWords } from "@innovateats/shared";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { messageRepository } from "@/lib/runtime";

const requestSchema = z.object({
  subject: z.string().trim().min(1).max(120).nullable(),
  body: z.string().trim().min(1).max(5_000)
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; draftId: string }> }
): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }

  try {
    const { id, draftId } = await context.params;
    const leadId = z.uuid().parse(id);
    const parsedDraftId = z.uuid().parse(draftId);
    const input = requestSchema.parse(await request.json());
    const repository = messageRepository();
    const workspace = await repository.getWorkspace(leadId);
    const previous = workspace.drafts.find((draft) => draft.id === parsedDraftId);
    if (previous === undefined || workspace.brief === null) {
      return Response.json(
        { error: { code: "not_found", message: "Message draft not found." } },
        { status: 404 }
      );
    }
    const content = {
      channel: previous.channel,
      sequenceStep: previous.sequenceStep,
      subject: input.subject,
      body: input.body,
      language: previous.language,
      personalizationTokens: previous.personalizationTokens,
      evidenceMap: remapHumanEditEvidence(previous, input.body),
      wordCount: countMessageWords(input.body)
    };
    const review = reviewMessageDraft(content, workspace.brief.brief.evidenceIds);
    const draft = await repository.versionDraft(leadId, parsedDraftId, content, review, actor);
    return Response.json({ data: { draft } }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
