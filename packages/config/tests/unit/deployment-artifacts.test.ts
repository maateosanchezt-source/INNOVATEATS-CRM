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
    expect(worker).toContain("USER worker");
    expect(worker).toContain("HEALTHCHECK");
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
});
