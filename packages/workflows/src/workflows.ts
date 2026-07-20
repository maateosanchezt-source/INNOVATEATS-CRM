import { condition, defineSignal, proxyActivities, setHandler } from "@temporalio/workflow";

import type {
  DiscoveryWorkflowInput,
  OutreachWorkflowInput,
  SequenceStopReason
} from "@innovateats/shared";

import {
  noResponseWaitMilliseconds,
  touchSteps,
  waitMillisecondsUntil,
  type DiscoveryActivities,
  type OutreachActivities,
  phaseZeroReadiness,
  type SystemReadinessResult
} from "./contracts.js";

export const pauseOutreachSignal = defineSignal("pauseOutreach");
export const resumeOutreachSignal = defineSignal("resumeOutreach");
export const stopOutreachSignal = defineSignal<[reason: SequenceStopReason]>("stopOutreach");

const durableActivities = proxyActivities<
  Pick<
    OutreachActivities,
    "markWorkflowStarted" | "prepareTouch" | "stopSequence" | "completeSequence"
  >
>({
  startToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 5
  }
});

// Gmail has no application idempotency token. Dispatch is deliberately attempted
// once; ambiguous provider outcomes are persisted for manual reconciliation.
const dispatchActivities = proxyActivities<Pick<OutreachActivities, "dispatchTouch">>({
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 1 }
});

const discoveryActivities = proxyActivities<DiscoveryActivities>({
  startToCloseTimeout: "15 minutes",
  retry: {
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 3
  }
});

export async function systemReadinessWorkflow(): Promise<SystemReadinessResult> {
  return phaseZeroReadiness(new Date(Date.now()).toISOString());
}

export async function instagramDiscoveryWorkflow(input: DiscoveryWorkflowInput): Promise<void> {
  await discoveryActivities.executeInstagramDiscovery(input.runId);
}

export async function outreachSequenceWorkflow(input: OutreachWorkflowInput): Promise<void> {
  let paused = false;
  let stopReason: SequenceStopReason | null = null;

  setHandler(pauseOutreachSignal, () => {
    paused = true;
  });
  setHandler(resumeOutreachSignal, () => {
    paused = false;
  });
  setHandler(stopOutreachSignal, (reason) => {
    stopReason = reason;
  });

  await durableActivities.markWorkflowStarted(input.sequenceId);

  for (const step of touchSteps) {
    while (true) {
      if (stopReason !== null) {
        await durableActivities.stopSequence(input.sequenceId, stopReason);
        return;
      }
      if (paused) {
        await condition(() => !paused || stopReason !== null);
        continue;
      }

      const prepared = await durableActivities.prepareTouch(input.sequenceId, step);
      if (prepared.action === "stop") {
        await durableActivities.stopSequence(input.sequenceId, prepared.reason);
        return;
      }
      if (prepared.action === "wait") {
        await condition(
          () => paused || stopReason !== null,
          waitMillisecondsUntil(prepared.scheduledAt, Date.now())
        );
        continue;
      }

      const dispatched = await dispatchActivities.dispatchTouch(
        input.sequenceId,
        prepared.outboundMessageId
      );
      if (dispatched.outcome === "blocked") {
        await durableActivities.stopSequence(input.sequenceId, "policy_block");
        return;
      }
      if (dispatched.outcome === "delivery_unknown") {
        await durableActivities.stopSequence(input.sequenceId, "delivery_unknown");
        return;
      }
      break;
    }
  }

  const interrupted = await condition(
    () => paused || stopReason !== null,
    noResponseWaitMilliseconds
  );
  if (interrupted) {
    if (stopReason !== null) {
      await durableActivities.stopSequence(input.sequenceId, stopReason);
      return;
    }
    await condition(() => !paused || stopReason !== null);
    if (stopReason !== null) {
      await durableActivities.stopSequence(input.sequenceId, stopReason);
      return;
    }
  }
  await durableActivities.completeSequence(input.sequenceId);
}
