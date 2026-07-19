import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Pool, PoolClient } from "pg";

export interface MigrationFile {
  readonly name: string;
  readonly checksum: string;
  readonly sql: string;
}

export async function readMigrationFiles(directory: string): Promise<readonly MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && /^\d{4}_[a-z0-9_-]+\.sql$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(path.join(directory, name), "utf8");
      return {
        name,
        checksum: createHash("sha256").update(sql).digest("hex"),
        sql
      };
    })
  );
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function applyMigrations(
  pool: Pool,
  migrationDirectory: string
): Promise<readonly string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  let advisoryLockAcquired = false;

  try {
    await client.query("SELECT pg_advisory_lock(hashtext('innovateats_schema_migrations'))");
    advisoryLockAcquired = true;
    await ensureMigrationTable(client);
    const migrations = await readMigrationFiles(migrationDirectory);

    for (const migration of migrations) {
      const result = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE name = $1",
        [migration.name]
      );
      const existing = result.rows[0];
      if (existing !== undefined) {
        if (existing.checksum !== migration.checksum) {
          throw new Error(`Migration checksum mismatch: ${migration.name}`);
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
          migration.name,
          migration.checksum
        ]);
        await client.query("COMMIT");
        applied.push(migration.name);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    return applied;
  } finally {
    try {
      if (advisoryLockAcquired) {
        await client.query("SELECT pg_advisory_unlock(hashtext('innovateats_schema_migrations'))");
      }
    } finally {
      client.release();
    }
  }
}
