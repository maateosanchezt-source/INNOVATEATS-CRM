import "dotenv/config";

import { fileURLToPath } from "node:url";

import { loadServerEnvironment } from "@innovateats/config";

import { createDatabaseClient } from "../src/client.js";
import { applyMigrations } from "../src/migrations.js";

const environment = loadServerEnvironment();
const client = createDatabaseClient(environment.DATABASE_URL);
const migrationDirectory = fileURLToPath(new URL("../drizzle", import.meta.url));

try {
  const applied = await applyMigrations(client.pool, migrationDirectory);
  process.stdout.write(
    applied.length === 0
      ? "Database is already up to date.\n"
      : `Applied migrations: ${applied.join(", ")}\n`
  );
} finally {
  await client.close();
}
