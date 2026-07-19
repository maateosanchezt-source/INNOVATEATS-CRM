import { toNextJsHandler } from "better-auth/next-js";

import { internalAuth } from "@/lib/runtime";

function handlers() {
  return toNextJsHandler(internalAuth());
}

export async function GET(request: Request): Promise<Response> {
  return handlers().GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return handlers().POST(request);
}
