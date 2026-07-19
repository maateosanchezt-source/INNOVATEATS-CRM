import "dotenv/config";

import { defineConfig } from "drizzle-kit";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://innovateats:innovateats-local-only@localhost:5432/innovateats";

export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/schema/index.ts",
  dbCredentials: {
    url: databaseUrl
  },
  migrations: {
    table: "drizzle_migrations",
    schema: "public"
  },
  strict: true,
  verbose: true
});
