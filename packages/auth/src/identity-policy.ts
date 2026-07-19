import { isAuthorizedEmail, normalizeEmail } from "@innovateats/shared";

export class UnauthorizedInternalIdentityError extends Error {
  public constructor() {
    super("This identity is not authorized for the InnovatEats internal application.");
    this.name = "UnauthorizedInternalIdentityError";
  }
}

export interface IdentityCandidate {
  readonly email: string;
  readonly emailVerified: boolean;
}

export function assertInternalIdentity(
  candidate: IdentityCandidate,
  authorizedEmail: string
): string {
  if (!candidate.emailVerified || !isAuthorizedEmail(candidate.email, authorizedEmail)) {
    throw new UnauthorizedInternalIdentityError();
  }

  return normalizeEmail(candidate.email);
}
