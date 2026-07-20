import { createServer, type Server } from "node:http";

export type WorkerLifecycle = "starting" | "ready" | "stopping" | "error";

export interface WorkerHealth {
  readonly lifecycle: WorkerLifecycle;
  readonly temporalConnected: boolean;
  readonly dryRun: boolean;
  readonly emailSendEnabled: boolean;
  readonly discoveryEnabled: boolean;
  readonly error?: string;
}

export class WorkerHealthServer {
  private state: WorkerHealth;
  private readonly server: Server;

  public constructor(port: number, initial: WorkerHealth) {
    this.state = initial;
    this.server = createServer((request, response) => {
      if (request.url !== "/health") {
        response.writeHead(404).end();
        return;
      }

      const ready = this.state.lifecycle === "ready" && this.state.temporalConnected;
      response.writeHead(ready ? 200 : 503, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json"
      });
      response.end(JSON.stringify({ service: "worker", ...this.state }));
    });
    this.server.listen(port);
  }

  public update(next: WorkerHealth): void {
    this.state = next;
  }

  public async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
  }
}
