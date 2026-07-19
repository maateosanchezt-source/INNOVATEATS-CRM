import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

const migrationDirectory = fileURLToPath(new URL("../drizzle", import.meta.url));
const migrationNames = (await readdir(migrationDirectory))
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
  .sort((left, right) => left.localeCompare(right));

if (migrationNames.length === 0) {
  throw new Error("No SQL migrations found.");
}

const database = new PGlite();

try {
  for (const name of migrationNames) {
    const sql = await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
    await database.exec(sql);
  }

  await database.exec(`
    INSERT INTO feature_flags (key, enabled, description, risk_tier, updated_by)
    VALUES ('global_dry_run', true, 'Prevent real actions', 'critical', 'migration-check');

    INSERT INTO audit_log (
      actor_type, actor_id, action, entity_type, entity_id, after_json
    ) VALUES (
      'system', 'migration-check', 'migration.verified', 'database', 'phase-0', '{"ok":true}'
    );
  `);

  let auditMutationBlocked = false;
  try {
    await database.exec("UPDATE audit_log SET action = 'tampered'");
  } catch {
    auditMutationBlocked = true;
  }

  if (!auditMutationBlocked) {
    throw new Error("Append-only audit protection did not block an update.");
  }

  const flags = await database.query<{ enabled: boolean }>(
    "SELECT enabled FROM feature_flags WHERE key = 'global_dry_run'"
  );
  if (flags.rows[0]?.enabled !== true) {
    throw new Error("Global dry-run migration invariant failed.");
  }

  const regionalTables = await database.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'region_policy_versions',
        'compliance_decisions',
        'social_manual_queue'
      )
    ORDER BY table_name
  `);
  if (regionalTables.rows.length !== 3) {
    throw new Error("Regional compliance migration tables are incomplete.");
  }

  process.stdout.write(`Verified ${migrationNames.length} migration(s) on an empty database.\n`);
} finally {
  await database.close();
}
