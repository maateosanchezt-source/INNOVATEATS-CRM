import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const templateUrl = new URL("../deploy/local.env.example", import.meta.url);
const destinationUrl = new URL("../deploy/local.env", import.meta.url);

function option(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value?.slice(prefix.length);
}

function isPrivateHost(host) {
  if (host === "localhost" || host === "127.0.0.1") {
    return true;
  }
  const octets = host.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return false;
  }
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function secret() {
  return randomBytes(32).toString("base64url");
}

async function main() {
  const host = option("host") ?? "127.0.0.1";
  if (!isPrivateHost(host)) {
    throw new Error("The local CRM host must be localhost or a private IPv4 address.");
  }

  const template = await readFile(templateUrl, "utf8");
  const databasePassword = secret();
  const content = template
    .replace("APP_URL=http://127.0.0.1:3000", `APP_URL=http://${host}:3000`)
    .replaceAll("GENERATE_DATABASE_PASSWORD", databasePassword)
    .replace("GENERATE_AUTH_SECRET", secret());

  if (/GENERATE_[A-Z_]+/u.test(content)) {
    throw new Error("A secret marker remains in the generated local environment.");
  }

  try {
    await writeFile(destinationUrl, content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      process.stdout.write(
        "deploy/local.env already exists; preserving its secrets and configuration.\n"
      );
      return;
    }
    throw error;
  }

  process.stdout.write(
    `Prepared deploy/local.env for http://${host}:3000. Generated secrets were not printed.\n`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown local preparation error.";
  process.stderr.write(`Local deployment preparation failed: ${message}\n`);
  process.exitCode = 1;
});
