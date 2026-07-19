import { ZodError } from "zod";

import {
  EvidenceNotFoundError,
  InvalidLeadTransitionError,
  LeadNotFoundError
} from "@innovateats/db";

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof SyntaxError) {
    return Response.json(
      { error: { code: "invalid_json", message: "A valid JSON request body is required." } },
      { status: 400 }
    );
  }

  if (error instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "invalid_request",
          message: "The request failed validation.",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message
          }))
        }
      },
      { status: 400 }
    );
  }

  if (error instanceof LeadNotFoundError || error instanceof EvidenceNotFoundError) {
    return Response.json({ error: { code: "not_found", message: error.message } }, { status: 404 });
  }

  if (error instanceof InvalidLeadTransitionError) {
    return Response.json(
      { error: { code: "invalid_transition", message: error.message } },
      { status: 409 }
    );
  }

  if (error instanceof Error && /public|URL|domain|credential/iu.test(error.message)) {
    return Response.json(
      { error: { code: "invalid_source_url", message: error.message } },
      { status: 400 }
    );
  }

  return Response.json(
    { error: { code: "internal_error", message: "The operation could not be completed." } },
    { status: 500 }
  );
}
