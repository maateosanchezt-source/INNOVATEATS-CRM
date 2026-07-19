import { WorkflowExecutionAlreadyStartedError, type Client } from "@temporalio/client";

import {
  PostgresOutreachRepository,
  type AppDatabase,
  type OutboxEventRecord
} from "@innovateats/db";
import { outreachSequenceWorkflow, stopOutreachSignal } from "@innovateats/workflows";

function workflowIsUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    ["WorkflowNotFoundError", "WorkflowExecutionAlreadyCompletedError"].includes(error.name)
  );
}

export async function dispatchSequenceOutboxEvent(
  temporal: Client,
  taskQueue: string,
  event: OutboxEventRecord
): Promise<void> {
  if (event.eventType === "sequence.start") {
    await temporal.workflow.start(outreachSequenceWorkflow, {
      taskQueue,
      workflowId: event.workflowId,
      args: [{ sequenceId: event.sequenceId }]
    });
    return;
  }
  if (event.reason === null) {
    throw new Error("Sequence stop event has no stop reason.");
  }
  await temporal.workflow.getHandle(event.workflowId).signal(stopOutreachSignal, event.reason);
}

export class SequenceOutboxProcessor {
  private timer: NodeJS.Timeout | undefined;
  private processing = false;

  public constructor(
    private readonly database: AppDatabase,
    private readonly temporal: Client,
    private readonly taskQueue: string
  ) {}

  public start(): void {
    if (this.timer !== undefined) {
      return;
    }
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, 5_000);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  public async tick(): Promise<void> {
    if (this.processing) {
      return;
    }
    this.processing = true;
    const repository = new PostgresOutreachRepository(this.database);
    try {
      while (true) {
        const event = await repository.claimNextOutboxEvent();
        if (event === null) {
          return;
        }
        try {
          await dispatchSequenceOutboxEvent(this.temporal, this.taskQueue, event);
          await repository.markOutboxProcessed(event.id);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Temporal outbox dispatch failed.";
          if (
            (event.eventType === "sequence.start" &&
              error instanceof WorkflowExecutionAlreadyStartedError) ||
            (event.eventType === "sequence.stop" && workflowIsUnavailable(error))
          ) {
            await repository.markOutboxProcessed(event.id);
          } else {
            await repository.markOutboxFailed(event.id, message);
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }
}
