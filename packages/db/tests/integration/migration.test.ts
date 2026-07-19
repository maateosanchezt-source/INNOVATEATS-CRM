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
        AND table_name IN (
          'user',
          'session',
          'account',
          'verification',
          'feature_flags',
          'kill_switches',
          'audit_log',
          'sources',
          'source_documents',
          'organizations',
          'leads',
          'evidence',
          'lead_status_history'
        )
      ORDER BY table_name
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "account",
      "audit_log",
      "evidence",
      "feature_flags",
      "kill_switches",
      "lead_status_history",
      "leads",
      "organizations",
      "session",
      "source_documents",
      "sources",
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

  it("enforces CRM score and lifecycle values", async () => {
    await database.exec(`
      INSERT INTO organizations (
        id, normalized_name, display_name, canonical_domain, country, stage
      ) VALUES (
        '10000000-0000-4000-8000-000000000099',
        'fixture',
        'Fixture',
        'fixture.example.test.invalid',
        'Spain',
        'prelaunch'
      )
    `);

    await expect(
      database.exec(`
        INSERT INTO leads (organization_id, status, icp_score)
        VALUES (
          '10000000-0000-4000-8000-000000000099',
          'unsafe_unknown_status',
          50
        )
      `)
    ).rejects.toThrow();

    await expect(
      database.exec(`
        INSERT INTO leads (organization_id, status, icp_score)
        VALUES (
          '10000000-0000-4000-8000-000000000099',
          'discovered',
          101
        )
      `)
    ).rejects.toThrow();
  });

  it("makes evidence content immutable and physical deletion impossible", async () => {
    await database.exec(`
      INSERT INTO organizations (
        id, normalized_name, display_name, canonical_domain, country, stage
      ) VALUES (
        '10000000-0000-4000-8000-000000000098',
        'evidence fixture',
        'Evidence Fixture',
        'evidence-fixture.example.test.invalid',
        'Spain',
        'prelaunch'
      );

      INSERT INTO leads (
        id, organization_id, status, icp_score
      ) VALUES (
        '20000000-0000-4000-8000-000000000098',
        '10000000-0000-4000-8000-000000000098',
        'discovered',
        50
      );

      INSERT INTO evidence (
        id,
        lead_id,
        fact_type,
        claim,
        quote_or_summary,
        source_url,
        observed_at,
        confidence,
        created_by
      ) VALUES (
        '40000000-0000-4000-8000-000000000098',
        '20000000-0000-4000-8000-000000000098',
        'product',
        'Original claim',
        'Original source summary',
        'https://innovateats.com',
        now(),
        1,
        'test'
      )
    `);

    await expect(
      database.exec(`
        UPDATE evidence
        SET claim = 'Silently overwritten'
        WHERE id = '40000000-0000-4000-8000-000000000098'
      `)
    ).rejects.toThrow(/immutable/);

    await expect(
      database.exec(`
        DELETE FROM evidence
        WHERE id = '40000000-0000-4000-8000-000000000098'
      `)
    ).rejects.toThrow(/cannot be deleted physically/);

    await expect(
      database.exec(`
        UPDATE evidence
        SET state = 'deleted', superseded_at = now()
        WHERE id = '40000000-0000-4000-8000-000000000098'
      `)
    ).resolves.not.toThrow();
  });
});
