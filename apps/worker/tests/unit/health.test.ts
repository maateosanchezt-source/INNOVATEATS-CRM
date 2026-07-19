import { request } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { WorkerHealthServer } from "../../src/health.js";

let server: WorkerHealthServer | undefined;

function fetchHealth(port: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: "127.0.0.1",
        method: "GET",
        path: "/health",
        port
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, body });
        });
      }
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("worker health", () => {
  it("is unavailable until Temporal is connected", async () => {
    const port = 31_001;
    server = new WorkerHealthServer(port, {
      lifecycle: "starting",
      temporalConnected: false,
      dryRun: true,
      emailSendEnabled: false
    });

    const response = await fetchHealth(port);

    expect(response.status).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({
      service: "worker",
      dryRun: true,
      emailSendEnabled: false
    });
  });

  it("is ready only with Temporal and safe Phase 0 controls", async () => {
    const port = 31_002;
    server = new WorkerHealthServer(port, {
      lifecycle: "ready",
      temporalConnected: true,
      dryRun: true,
      emailSendEnabled: false
    });

    const response = await fetchHealth(port);

    expect(response.status).toBe(200);
  });
});
