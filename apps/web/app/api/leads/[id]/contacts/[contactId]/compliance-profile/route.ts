import { z } from "zod";

import {
  consentStatusSchema,
  languageProficiencySchema,
  subscriberTypeSchema
} from "@innovateats/shared";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { complianceRepository } from "@/lib/runtime";

const inputSchema = z
  .object({
    subscriberType: subscriberTypeSchema,
    consentStatus: consentStatusSchema,
    languageProficiency: languageProficiencySchema,
    evidenceNote: z.string().trim().max(1_000).default("")
  })
  .superRefine((value, context) => {
    if (
      ["express", "inferred", "prior_relationship"].includes(value.consentStatus) &&
      value.evidenceNote.length < 10
    ) {
      context.addIssue({
        code: "custom",
        message: "A consent claim requires a specific evidence note.",
        path: ["evidenceNote"]
      });
    }
  });

export async function PATCH(
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
    const input = inputSchema.parse(await request.json());
    await complianceRepository().updateContactProfile(
      leadId,
      parsedContactId,
      {
        subscriberType: input.subscriberType,
        consentStatus: input.consentStatus,
        languageProficiency: input.languageProficiency,
        evidence:
          input.evidenceNote === ""
            ? {}
            : { note: input.evidenceNote, recordedAt: new Date().toISOString() }
      },
      actor
    );
    return Response.json({ data: { updated: true } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
