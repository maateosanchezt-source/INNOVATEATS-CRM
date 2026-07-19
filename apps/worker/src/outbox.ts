import { WorkflowExecutionAlreadyStartedError, type Client } from "@temporalio/client";

import { PostgresOutreachRepository, type AppDatabase } from "@innovateats/db";
import { outreachSequenceWorkflow } from "@innovateats/workflows";

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
          await this.temporal.workflow.start(outreachSequenceWorkflow, {
            taskQueue: this.taskQueue,
            workflowId: event.workflowId,
            args: [{ sequenceId: event.sequenceId }]
          });
          await repository.markOutboxProcessed(event.id);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Temporal workflow start failed.";
          if (error instanceof WorkflowExecutionAlreadyStartedError) {
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
