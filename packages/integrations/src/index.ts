export interface ProviderHealth {
  readonly provider: string;
  readonly configured: boolean;
  readonly healthy: boolean;
  readonly detail?: string;
}

export class PhaseZeroProviderDisabledError extends Error {
  public constructor(provider: string) {
    super(`${provider} execution is disabled during Phase 0.`);
    this.name = "PhaseZeroProviderDisabledError";
  }
}

export {
  DisabledEmailVerificationProvider,
  FixtureEmailVerificationProvider,
  NodeMxResolver,
  verifyBusinessEmail,
  type EmailProviderResult,
  type EmailVerificationProvider,
  type MxResolver,
  type VerifyBusinessEmailOptions
} from "./email-verifier.js";
export {
  DisabledSearchProvider,
  FixtureSearchProvider,
  SearchProviderDisabledError,
  type SearchProvider
} from "./search-provider.js";
export {
  isPublicIpAddress,
  NodePinnedHttpTransport,
  NodePublicDnsResolver,
  SecureFetchError,
  SecurePublicFetcher,
  type PinnedHttpRequest,
  type PinnedHttpResponse,
  type PinnedHttpTransport,
  type PublicDnsResolver,
  type ResolvedAddress,
  type SecurePublicFetcherOptions
} from "./secure-fetch.js";
