import { isAuthorizedEmail } from "@innovateats/shared";

import { environment, internalAuth } from "@/lib/runtime";

export async function requireApiActor(request: Request): Promise<string | Response> {
  const session = await internalAuth().api.getSession({ headers: request.headers });
  const config = environment();

  if (session === null || !isAuthorizedEmail(session.user.email, config.AUTHORIZED_EMAIL)) {
    return Response.json(
      { error: { code: "unauthorized", message: "Authentication is required." } },
      { status: 401 }
    );
  }

  return session.user.email;
}
