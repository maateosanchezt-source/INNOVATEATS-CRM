import "dotenv/config";

import { loadServerEnvironment } from "@innovateats/config";

import { createDatabaseClient } from "../src/client.js";
import { seedFoundations } from "../src/seed-data.js";

const environment = loadServerEnvironment();
const client = createDatabaseClient(environment.DATABASE_URL);

try {
  await seedFoundations(client.db);
  process.stdout.write("Foundation seed is present.\n");
} finally {
  await client.close();
}
