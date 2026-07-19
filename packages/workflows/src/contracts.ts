export interface SystemReadinessResult {
  readonly ready: true;
  readonly dryRun: true;
  readonly emailSendEnabled: false;
  readonly checkedAt: string;
}

export function phaseZeroReadiness(checkedAt: string): SystemReadinessResult {
  return {
    ready: true,
    dryRun: true,
    emailSendEnabled: false,
    checkedAt
  };
}
