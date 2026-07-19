import type {
  DispatchTouchResult,
  PrepareTouchResult,
  SequenceStopReason
} from "@innovateats/shared";

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

export interface OutreachActivities {
  markWorkflowStarted(sequenceId: string): Promise<void>;
  prepareTouch(sequenceId: string, step: 1 | 2 | 3): Promise<PrepareTouchResult>;
  dispatchTouch(sequenceId: string, outboundMessageId: string): Promise<DispatchTouchResult>;
  stopSequence(sequenceId: string, reason: SequenceStopReason): Promise<void>;
  completeSequence(sequenceId: string): Promise<void>;
}

export const touchSteps = [1, 2, 3] as const;
export const noResponseWaitMilliseconds = 7 * 24 * 60 * 60 * 1_000;

export function waitMillisecondsUntil(scheduledAt: string, nowMilliseconds: number): number {
  return Math.max(0, new Date(scheduledAt).getTime() - nowMilliseconds);
}
