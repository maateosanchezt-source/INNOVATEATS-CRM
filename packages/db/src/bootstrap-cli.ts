import { fileURLToPath } from "node:url";

import { loadServerEnvironment } from "@innovateats/config";

import { createDatabaseClient } from "./client.js";
import { applyMigrations } from "./migrations.js";
import { seedFoundations } from "./seed-data.js";

const environment = loadServerEnvironment();
const client = createDatabaseClient(environment.DATABASE_URL);
const migrationDirectory = fileURLToPath(new URL("../drizzle", import.meta.url));

try {
  const applied = await applyMigrations(client.pool, migrationDirectory);
  await seedFoundations(client.db);
  process.stdout.write(
    applied.length === 0
      ? "Database is current and required foundations are present.\n"
      : `Applied ${applied.length} migration(s); required foundations are present.\n`
  );
} finally {
  await client.close();
}
