import { readFile } from "node:fs/promises";
import path from "node:path";

import { deploymentModes, preflightDeployment, type DeploymentMode } from "./deployment.js";
import { parseServerEnvironment } from "./env.js";

function option(name: string): string | undefined {
  const direct = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (direct !== undefined) {
    return direct.slice(name.length + 3);
  }
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function parseEnvironmentFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [index, rawLine] of content.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const equals = normalized.indexOf("=");
    if (equals <= 0) {
      throw new Error(`Invalid environment assignment on line ${index + 1}.`);
    }
    const key = normalized.slice(0, equals).trim();
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) {
      throw new Error(`Invalid environment key on line ${index + 1}.`);
    }
    if (Object.hasOwn(result, key)) {
      throw new Error(`Duplicate environment key ${key}.`);
    }
    const rawValue = normalized.slice(equals + 1).trim();
    const quoted =
      rawValue.length >= 2 &&
      ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'")));
    result[key] = quoted ? rawValue.slice(1, -1) : rawValue;
  }
  return result;
}

async function main(): Promise<void> {
  const modeValue = option("mode") ?? "dry_run";
  if (!deploymentModes.includes(modeValue as DeploymentMode)) {
    throw new Error(`Unknown deployment mode "${modeValue}".`);
  }
  const file = option("env-file");
  const fromFile =
    file === undefined
      ? {}
      : parseEnvironmentFile(
          await readFile(path.resolve(process.env.INIT_CWD ?? process.cwd(), file), "utf8")
        );
  const environment = parseServerEnvironment({
    ...process.env,
    ...fromFile
  });
  const report = preflightDeployment(environment, modeValue as DeploymentMode);
  for (const item of report.checks) {
    process.stdout.write(`[${item.status.toUpperCase()}] ${item.key}: ${item.message}\n`);
  }
  process.stdout.write(
    report.ready
      ? `Deployment preflight passed for ${report.expectedMode}.\n`
      : `Deployment preflight failed for ${report.expectedMode}.\n`
  );
  if (!report.ready) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown preflight error.";
  process.stderr.write(`Deployment preflight could not run: ${message}\n`);
  process.exitCode = 1;
});
