import { z } from "zod";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { environment, gmailAuthRepository, gmailOAuth } from "@/lib/runtime";

const inputSchema = z.object({
  leadId: z.uuid()
});

export async function POST(request: Request): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }
  try {
    const input = inputSchema.parse(await request.json());
    const returnPath = `/leads/${input.leadId}`;
    const config = environment();
    const senderEmail = config.GMAIL_SENDER_EMAIL || config.AUTHORIZED_EMAIL;
    const state = await gmailAuthRepository().createOAuthState(senderEmail, returnPath, actor);
    return Response.json({ data: { authorizationUrl: gmailOAuth().authorizationUrl(state) } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
