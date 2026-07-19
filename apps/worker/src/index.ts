import { fileURLToPath } from "node:url";

import { loadServerEnvironment } from "@innovateats/config";
import { createLogger } from "@innovateats/observability";
import { NativeConnection, Worker } from "@temporalio/worker";

import { WorkerHealthServer } from "./health.js";

const environment = loadServerEnvironment();
const logger = createLogger("innovateats-worker");
const health = new WorkerHealthServer(environment.WORKER_HEALTH_PORT, {
  lifecycle: "starting",
  temporalConnected: false,
  dryRun: environment.GLOBAL_DRY_RUN,
  emailSendEnabled: environment.EMAIL_SEND_ENABLED
});

let connection: NativeConnection | undefined;
let worker: Worker | undefined;
let stopping = false;

async function stop(signal: string): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;

  logger.info({ signal }, "Worker shutdown requested");
  health.update({
    lifecycle: "stopping",
    temporalConnected: connection !== undefined,
    dryRun: environment.GLOBAL_DRY_RUN,
    emailSendEnabled: environment.EMAIL_SEND_ENABLED
  });

  worker?.shutdown();
  await connection?.close();
  await health.close();
}

process.once("SIGINT", () => {
  void stop("SIGINT");
});
process.once("SIGTERM", () => {
  void stop("SIGTERM");
});

try {
  connection = await NativeConnection.connect({
    address: environment.TEMPORAL_ADDRESS
  });
  const workflowsPath = fileURLToPath(import.meta.resolve("@innovateats/workflows/workflows"));

  worker = await Worker.create({
    connection,
    namespace: environment.TEMPORAL_NAMESPACE,
    taskQueue: environment.TEMPORAL_TASK_QUEUE,
    workflowsPath
  });

  health.update({
    lifecycle: "ready",
    temporalConnected: true,
    dryRun: environment.GLOBAL_DRY_RUN,
    emailSendEnabled: environment.EMAIL_SEND_ENABLED
  });
  logger.info(
    {
      dryRun: environment.GLOBAL_DRY_RUN,
      emailSendEnabled: environment.EMAIL_SEND_ENABLED,
      namespace: environment.TEMPORAL_NAMESPACE,
      taskQueue: environment.TEMPORAL_TASK_QUEUE
    },
    "Worker ready"
  );

  await worker.run();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown worker error";
  health.update({
    lifecycle: "error",
    temporalConnected: false,
    dryRun: environment.GLOBAL_DRY_RUN,
    emailSendEnabled: environment.EMAIL_SEND_ENABLED,
    error: message
  });
  logger.error({ error }, "Worker failed");
  process.exitCode = 1;
}
