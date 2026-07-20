import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

async function repositoryFile(path: string): Promise<string> {
  return readFile(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

describe("production deployment artifacts", () => {
  it("uses non-root production image targets with health checks", async () => {
    const [web, worker] = await Promise.all([
      repositoryFile("apps/web/Dockerfile"),
      repositoryFile("apps/worker/Dockerfile")
    ]);

    expect(web).toContain("AS web-runtime");
    expect(web).toContain("USER nextjs");
    expect(web).toContain("HEALTHCHECK");
    expect(web).not.toContain('CMD ["pnpm", "--filter", "@innovateats/web", "dev"]');
    expect(worker).toContain("AS worker-runtime");
    expect(worker).toContain("node:22.23.0-bookworm-slim");
    expect(worker).toContain("USER worker");
    expect(worker).toContain("HEALTHCHECK");
    expect(worker).not.toContain("alpine");
    expect(worker).not.toContain('CMD ["pnpm", "--filter", "@innovateats/worker", "dev"]');
  });

  it("bootstraps before web/worker and never provisions an insecure production database", async () => {
    const compose = await repositoryFile("deploy/compose.production.yaml");

    expect(compose).toContain("service_completed_successfully");
    expect(compose).toContain('command: ["node", "packages/db/dist/bootstrap-cli.js"]');
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).toContain("read_only: true");
    expect(compose).not.toMatch(/^\s{2}postgres:/mu);
    expect(compose).not.toMatch(/POSTGRES_PASSWORD/u);
  });

  it("ships only a fail-closed placeholder template", async () => {
    const environment = await repositoryFile("deploy/runtime.env.example");

    expect(environment).toContain("GLOBAL_DRY_RUN=true");
    expect(environment).toContain("EMAIL_SEND_ENABLED=false");
    expect(environment).toContain("AUTONOMOUS_SEND_ENABLED=false");
    expect(environment).toContain("PRODUCTION_SEND_APPROVED=false");
    expect(environment).toContain("GMAIL_DELIVERY_MODE=dry_run");
    expect(environment).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/u);
  });

  it("packages a LAN deployment with generated secrets and isolated service ports", async () => {
    const [compose, environment, generator, gitignore, dynamicConfig] = await Promise.all([
      repositoryFile("deploy/compose.local.yaml"),
      repositoryFile("deploy/local.env.example"),
      repositoryFile("scripts/prepare-local-deployment.mjs"),
      repositoryFile(".gitignore"),
      repositoryFile("config/temporal/development-sql.yaml")
    ]);

    expect(compose).toContain("target: web-runtime");
    expect(compose).toContain("target: worker-runtime");
    expect(compose).toContain("service_completed_successfully");
    expect(compose).toContain("temporalio/auto-setup:1.29.7");
    expect(compose).toContain("../config/temporal:/etc/temporal/config/dynamicconfig:ro");
    expect(compose).toContain("127.0.0.1:${WORKER_HOST_PORT:-3002}:3001");
    expect(compose).toContain("${WEB_BIND_ADDRESS:-0.0.0.0}");
    expect(compose).not.toContain("minio");
    expect(environment).toContain("GLOBAL_DRY_RUN=true");
    expect(environment).toContain("EMAIL_SEND_ENABLED=false");
    expect(environment).toContain("BETTER_AUTH_SECRET=GENERATE_AUTH_SECRET");
    expect(generator).toContain('randomBytes(32).toString("base64url")');
    expect(generator).toContain('flag: "wx"');
    expect(gitignore).toContain("deploy/local.env");
    expect(dynamicConfig).toContain("limit.maxIDLength:");
  });
});
