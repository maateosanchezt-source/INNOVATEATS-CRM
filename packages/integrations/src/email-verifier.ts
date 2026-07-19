import { resolveMx } from "node:dns/promises";
import { domainToASCII } from "node:url";

import { z } from "zod";

import {
  emailProviderVerdictSchema,
  emailVerificationResultSchema,
  type ContactOrigin,
  type EmailProviderVerdict,
  type EmailVerificationResult
} from "@innovateats/shared";

export interface EmailProviderResult {
  readonly verdict: EmailProviderVerdict;
  readonly reason: string;
}

export interface EmailVerificationProvider {
  readonly name: string;
  readonly configured: boolean;
  verify(email: string): Promise<EmailProviderResult>;
}

export class DisabledEmailVerificationProvider implements EmailVerificationProvider {
  public readonly name = "disabled";
  public readonly configured = false;

  public async verify(): Promise<EmailProviderResult> {
    await Promise.resolve();
    return {
      verdict: "unknown",
      reason: "No mailbox verification provider is configured."
    };
  }
}

export class FixtureEmailVerificationProvider implements EmailVerificationProvider {
  public readonly configured = true;

  public constructor(
    public readonly name: string,
    private readonly fixtures: Readonly<Record<string, EmailProviderResult>>
  ) {}

  public async verify(email: string): Promise<EmailProviderResult> {
    await Promise.resolve();
    const result = this.fixtures[email.toLowerCase()] ?? {
      verdict: "unknown",
      reason: "No fixture verdict."
    };
    return {
      verdict: emailProviderVerdictSchema.parse(result.verdict),
      reason: z.string().trim().min(1).max(500).parse(result.reason)
    };
  }
}

export interface MxResolver {
  hasMx(domain: string): Promise<boolean>;
}

export class NodeMxResolver implements MxResolver {
  public async hasMx(domain: string): Promise<boolean> {
    const records = await resolveMx(domain);
    return records.some((record) => record.exchange.trim() !== "");
  }
}

export interface VerifyBusinessEmailOptions {
  readonly origin: ContactOrigin;
  readonly now?: () => Date;
}

export async function verifyBusinessEmail(
  rawEmail: string,
  mxResolver: MxResolver,
  provider: EmailVerificationProvider,
  options: VerifyBusinessEmailOptions
): Promise<EmailVerificationResult> {
  const email = rawEmail.trim();
  const normalizedEmail = email.toLowerCase();
  const syntax = z.email().safeParse(normalizedEmail);
  const rawDomain = normalizedEmail.split("@")[1] ?? "";
  const domain = domainToASCII(rawDomain).toLowerCase();
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();

  if (!syntax.success || domain === "") {
    return emailVerificationResultSchema.parse({
      email,
      normalizedEmail,
      domain,
      syntaxValid: false,
      mxFound: false,
      provider: null,
      providerVerdict: "unknown",
      status: "invalid",
      reason: "Email syntax or domain is invalid.",
      checkedAt
    });
  }

  let mxFound: boolean;
  try {
    mxFound = await mxResolver.hasMx(domain);
  } catch {
    return emailVerificationResultSchema.parse({
      email,
      normalizedEmail,
      domain,
      syntaxValid: true,
      mxFound: false,
      provider: null,
      providerVerdict: "unknown",
      status: "manual_review",
      reason: "MX lookup could not be completed; the address was not treated as invalid.",
      checkedAt
    });
  }
  if (!mxFound) {
    return emailVerificationResultSchema.parse({
      email,
      normalizedEmail,
      domain,
      syntaxValid: true,
      mxFound: false,
      provider: null,
      providerVerdict: "unknown",
      status: "invalid",
      reason: "The email domain has no MX record.",
      checkedAt
    });
  }

  let providerResult: EmailProviderResult;
  try {
    providerResult = await provider.verify(normalizedEmail);
  } catch {
    providerResult = {
      verdict: "unknown",
      reason: "Mailbox provider lookup failed closed."
    };
  }
  const verdict = emailProviderVerdictSchema.parse(providerResult.verdict);
  const status =
    verdict === "invalid"
      ? "invalid"
      : verdict === "risky"
        ? "risky"
        : verdict === "verified"
          ? options.origin === "inferred_pattern"
            ? "manual_review"
            : "provider_verified"
          : "mx_valid";

  return emailVerificationResultSchema.parse({
    email,
    normalizedEmail,
    domain,
    syntaxValid: true,
    mxFound: true,
    provider: provider.configured ? provider.name : null,
    providerVerdict: verdict,
    status,
    reason:
      options.origin === "inferred_pattern" && verdict === "verified"
        ? "Provider found a mailbox, but inferred patterns can never become verified contacts."
        : providerResult.reason,
    checkedAt
  });
}
