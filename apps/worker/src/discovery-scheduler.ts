import { WorkflowExecutionAlreadyStartedError, type Client } from "@temporalio/client";

import { PostgresDiscoveryRepository, type AppDatabase } from "@innovateats/db";
import { instagramDiscoveryWorkflow } from "@innovateats/workflows";

export class DiscoveryScheduler {
  private timer: NodeJS.Timeout | undefined;
  private processing = false;

  public constructor(
    private readonly database: AppDatabase,
    private readonly temporal: Client,
    private readonly taskQueue: string,
    private readonly intervalMilliseconds: number
  ) {}

  public start(): void {
    if (this.timer !== undefined) {
      return;
    }
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMilliseconds);
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
    const repository = new PostgresDiscoveryRepository(this.database);
    try {
      await repository.queueDueRuns();
      const queued = await repository.listQueuedRuns();
      for (const run of queued) {
        try {
          await this.temporal.workflow.start(instagramDiscoveryWorkflow, {
            taskQueue: this.taskQueue,
            workflowId: run.workflowId,
            args: [{ runId: run.id }]
          });
        } catch (error) {
          if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
            throw error;
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }
}
