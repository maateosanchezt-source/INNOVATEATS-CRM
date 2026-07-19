import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import { schema } from "./schema/index.js";

export type AppDatabase = NodePgDatabase<typeof schema>;

export interface DatabaseClient {
  readonly db: AppDatabase;
  readonly pool: Pool;
  close(): Promise<void>;
}

export function createDatabaseClient(
  connectionString: string,
  overrides: Readonly<PoolConfig> = {}
): DatabaseClient {
  const pool = new Pool({
    application_name: "innovateats-outreach-os",
    connectionString,
    idleTimeoutMillis: 30_000,
    max: 10,
    ...overrides
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
    close: async () => {
      await pool.end();
    }
  };
}
