import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationDirectory = fileURLToPath(new URL("../../drizzle", import.meta.url));

async function applyAllMigrations(database: PGlite): Promise<void> {
  const names = (await readdir(migrationDirectory))
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right));

  for (const name of names) {
    const sql = await readFile(new URL(`../../drizzle/${name}`, import.meta.url), "utf8");
    await database.exec(sql);
  }
}

describe("foundation migration", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await applyAllMigrations(database);
  });

  afterEach(async () => {
    await database.close();
  });

  it("creates auth and safety tables", async () => {
    const result = await database.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('user', 'session', 'account', 'verification', 'feature_flags', 'kill_switches', 'audit_log')
      ORDER BY table_name
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "account",
      "audit_log",
      "feature_flags",
      "kill_switches",
      "session",
      "user",
      "verification"
    ]);
  });

  it("makes audit rows append-only", async () => {
    await database.exec(`
      INSERT INTO audit_log (
        actor_type, action, entity_type, entity_id, after_json
      ) VALUES (
        'system', 'test.created', 'test', '1', '{"created":true}'
      )
    `);

    await expect(database.exec("DELETE FROM audit_log")).rejects.toThrow(/append-only/);
    await expect(database.exec("UPDATE audit_log SET action = 'test.tampered'")).rejects.toThrow(
      /append-only/
    );
  });

  it("permits only one active kill switch per scope", async () => {
    await database.exec(`
      INSERT INTO kill_switches (
        scope_type, reason, activated_by
      ) VALUES (
        'global', 'first incident', 'test'
      )
    `);

    await expect(
      database.exec(`
        INSERT INTO kill_switches (
          scope_type, reason, activated_by
        ) VALUES (
          'global', 'second incident', 'test'
        )
      `)
    ).rejects.toThrow();
  });

  it("rejects unknown feature flags", async () => {
    await expect(
      database.exec(`
        INSERT INTO feature_flags (
          key, enabled, description, updated_by
        ) VALUES (
          'unsafe_unknown_flag', true, 'not allowed', 'test'
        )
      `)
    ).rejects.toThrow();
  });
});
