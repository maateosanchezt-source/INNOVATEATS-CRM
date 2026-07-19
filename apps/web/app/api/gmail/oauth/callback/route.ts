import { encryptGmailRefreshToken } from "@innovateats/integrations";

import { requireApiActor } from "@/lib/api-auth";
import { apiErrorResponse } from "@/lib/api-response";
import { environment, gmailAuthRepository, gmailOAuth } from "@/lib/runtime";

export async function GET(request: Request): Promise<Response> {
  const actor = await requireApiActor(request);
  if (actor instanceof Response) {
    return actor;
  }
  try {
    const url = new URL(request.url);
    const stateValue = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (stateValue === null || code === null) {
      return Response.json(
        {
          error: { code: "invalid_oauth_callback", message: "OAuth state and code are required." }
        },
        { status: 400 }
      );
    }
    const state = await gmailAuthRepository().consumeOAuthState(stateValue, actor);
    const grant = await gmailOAuth().exchangeCode(code);
    if (grant.senderEmail !== state.senderEmail) {
      throw new Error("Gmail callback identity does not match the requested sender.");
    }
    const key = environment().GMAIL_TOKEN_ENCRYPTION_KEY;
    if (key === undefined) {
      throw new Error("Gmail token encryption is not configured.");
    }
    await gmailAuthRepository().saveGrant(
      grant.senderEmail,
      encryptGmailRefreshToken(grant.refreshToken, key),
      grant.scopes,
      actor
    );
    return Response.redirect(new URL(`${state.returnPath}?gmail=connected`, request.url), 303);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
