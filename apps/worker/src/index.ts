import { fileURLToPath } from "node:url";

import { loadServerEnvironment, temporalConnectionConfiguration } from "@innovateats/config";
import { createDatabaseClient, type DatabaseClient } from "@innovateats/db";
import { createLogger } from "@innovateats/observability";
import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";

import { createOutreachActivities } from "./activities.js";
import { WorkerHealthServer } from "./health.js";
import { GmailInboundPoller } from "./inbound.js";
import { SequenceOutboxProcessor } from "./outbox.js";

const environment = loadServerEnvironment();
const logger = createLogger("innovateats-worker");
const health = new WorkerHealthServer(environment.WORKER_HEALTH_PORT, {
  lifecycle: "starting",
  temporalConnected: false,
  dryRun: environment.GLOBAL_DRY_RUN,
  emailSendEnabled: environment.EMAIL_SEND_ENABLED
});

let connection: NativeConnection | undefined;
let clientConnection: Connection | undefined;
let database: DatabaseClient | undefined;
let worker: Worker | undefined;
let outbox: SequenceOutboxProcessor | undefined;
let inbound: GmailInboundPoller | undefined;
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
  outbox?.stop();
  inbound?.stop();
  await connection?.close();
  await clientConnection?.close();
  await database?.close();
  await health.close();
}

process.once("SIGINT", () => {
  void stop("SIGINT");
});
process.once("SIGTERM", () => {
  void stop("SIGTERM");
});

try {
  database = createDatabaseClient(environment.DATABASE_URL);
  const temporalOptions = temporalConnectionConfiguration(environment);
  connection = await NativeConnection.connect(temporalOptions);
  clientConnection = await Connection.connect(temporalOptions);
  const temporal = new Client({
    connection: clientConnection,
    namespace: environment.TEMPORAL_NAMESPACE
  });
  const workflowsPath = fileURLToPath(import.meta.resolve("@innovateats/workflows/workflows"));

  worker = await Worker.create({
    activities: createOutreachActivities(database.db, environment),
    connection,
    namespace: environment.TEMPORAL_NAMESPACE,
    taskQueue: environment.TEMPORAL_TASK_QUEUE,
    workflowsPath
  });
  outbox = new SequenceOutboxProcessor(database.db, temporal, environment.TEMPORAL_TASK_QUEUE);
  outbox.start();
  inbound = new GmailInboundPoller(database.db, environment, logger);
  inbound.start();

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
      inboundProcessingEnabled: environment.INBOUND_PROCESSING_ENABLED,
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
