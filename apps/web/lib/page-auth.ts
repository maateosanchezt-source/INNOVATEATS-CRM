import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isAuthorizedEmail } from "@innovateats/shared";

import { environment, internalAuth } from "@/lib/runtime";

export async function requirePageActor(): Promise<string> {
  const session = await internalAuth().api.getSession({ headers: await headers() });
  const config = environment();

  if (session === null || !isAuthorizedEmail(session.user.email, config.AUTHORIZED_EMAIL)) {
    redirect("/sign-in");
  }

  return session.user.email;
}
