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
