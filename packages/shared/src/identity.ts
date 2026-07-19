export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAuthorizedEmail(candidate: string, authorizedEmail: string): boolean {
  return normalizeEmail(candidate) === normalizeEmail(authorizedEmail);
}
