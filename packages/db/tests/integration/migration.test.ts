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

describe("database migrations", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await applyAllMigrations(database);
  }, 30_000);

  afterEach(async () => {
    await database.close();
  }, 30_000);

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
          'agent_runs',
          'contacts',
          'contact_verifications',
          'sources',
          'source_documents',
          'organizations',
          'founders',
          'leads',
          'lead_scores',
          'evidence',
          'lead_status_history',
          'strategy_briefs',
          'message_drafts',
          'message_approvals'
        )
      ORDER BY table_name
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "account",
      "agent_runs",
      "audit_log",
      "contact_verifications",
      "contacts",
      "evidence",
      "feature_flags",
      "founders",
      "kill_switches",
      "lead_scores",
      "lead_status_history",
      "leads",
      "message_approvals",
      "message_drafts",
      "organizations",
      "session",
      "source_documents",
      "sources",
      "strategy_briefs",
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

  it("makes scored explanations append-only and validates agent run accounting", async () => {
    await database.exec(`
      INSERT INTO organizations (
        id, normalized_name, display_name, canonical_domain, country, stage
      ) VALUES (
        '10000000-0000-4000-8000-000000000097',
        'score fixture',
        'Score Fixture',
        'score-fixture.example.test.invalid',
        'Spain',
        'prelaunch'
      );

      INSERT INTO leads (
        id, organization_id, status, icp_score
      ) VALUES (
        '20000000-0000-4000-8000-000000000097',
        '10000000-0000-4000-8000-000000000097',
        'researched',
        0
      );

      INSERT INTO lead_scores (
        id,
        lead_id,
        rubric_version,
        breakdown_json,
        explanations_json,
        total,
        confidence,
        evidence_ids_json,
        missing_information_json,
        hard_exclusion,
        recommended_action,
        created_by
      ) VALUES (
        '60000000-0000-4000-8000-000000000097',
        '20000000-0000-4000-8000-000000000097',
        'icp-v1',
        '{"productCategory":15}',
        '{"productCategory":"One hero product"}',
        85,
        0.8,
        '["evidence-1"]',
        '[]',
        false,
        'advance',
        'test'
      );
    `);

    await expect(
      database.exec(`
        UPDATE lead_scores
        SET total = 100
        WHERE id = '60000000-0000-4000-8000-000000000097'
      `)
    ).rejects.toThrow(/append-only/);

    await expect(
      database.exec(`
        INSERT INTO agent_runs (
          agent_name, prompt_version, model, input_hash, tokens_in
        ) VALUES (
          'fixture', 'v1', 'fixture-model', 'not-a-hash', -1
        )
      `)
    ).rejects.toThrow();
  });

  it("blocks invalid contact associations and guessed verification claims", async () => {
    await database.exec(`
      INSERT INTO sources (id, type, name)
      VALUES (
        '30000000-0000-4000-8000-000000000096',
        'secure_fetch',
        'Contact fixture'
      );

      INSERT INTO source_documents (
        id, source_id, url, canonical_url, content_hash, trust_level
      ) VALUES (
        '31000000-0000-4000-8000-000000000096',
        '30000000-0000-4000-8000-000000000096',
        'https://contact-fixture.example.test.invalid/contact',
        'https://contact-fixture.example.test.invalid/contact',
        '${"a".repeat(64)}',
        'primary'
      );

      INSERT INTO organizations (
        id, normalized_name, display_name, canonical_domain, country, stage
      ) VALUES
      (
        '10000000-0000-4000-8000-000000000096',
        'contact fixture',
        'Contact Fixture',
        'contact-fixture.example.test.invalid',
        'Spain',
        'prelaunch'
      ),
      (
        '10000000-0000-4000-8000-000000000095',
        'unrelated fixture',
        'Unrelated Fixture',
        'unrelated-fixture.example.test.invalid',
        'Spain',
        'prelaunch'
      );

      INSERT INTO leads (id, organization_id, status)
      VALUES
      (
        '20000000-0000-4000-8000-000000000096',
        '10000000-0000-4000-8000-000000000096',
        'scored'
      ),
      (
        '20000000-0000-4000-8000-000000000095',
        '10000000-0000-4000-8000-000000000095',
        'scored'
      );

      INSERT INTO evidence (
        id,
        lead_id,
        source_document_id,
        fact_type,
        claim,
        quote_or_summary,
        source_url,
        observed_at,
        confidence,
        created_by
      ) VALUES (
        '40000000-0000-4000-8000-000000000096',
        '20000000-0000-4000-8000-000000000096',
        '31000000-0000-4000-8000-000000000096',
        'source_snapshot',
        'Official contact snapshot',
        'hello@contact-fixture.example.test.invalid',
        'https://contact-fixture.example.test.invalid/contact',
        now(),
        1,
        'test'
      );

      INSERT INTO contacts (
        id,
        organization_id,
        source_document_id,
        evidence_id,
        channel_type,
        value,
        normalized_value,
        direct_url,
        source_url,
        origin,
        provenance,
        verification_status,
        confidence
      ) VALUES (
        '70000000-0000-4000-8000-000000000096',
        '10000000-0000-4000-8000-000000000096',
        '31000000-0000-4000-8000-000000000096',
        '40000000-0000-4000-8000-000000000096',
        'corporate_email',
        'hello@contact-fixture.example.test.invalid',
        'hello@contact-fixture.example.test.invalid',
        'mailto:hello@contact-fixture.example.test.invalid',
        'https://contact-fixture.example.test.invalid/contact',
        'published_public',
        'Official mailto',
        'published_verified',
        0.99
      );
    `);

    await expect(
      database.exec(`
        INSERT INTO contacts (
          organization_id,
          source_document_id,
          evidence_id,
          channel_type,
          value,
          normalized_value,
          direct_url,
          source_url,
          origin,
          provenance,
          verification_status,
          confidence
        ) VALUES (
          '10000000-0000-4000-8000-000000000095',
          '31000000-0000-4000-8000-000000000096',
          '40000000-0000-4000-8000-000000000096',
          'corporate_email',
          'wrong@unrelated-fixture.example.test.invalid',
          'wrong@unrelated-fixture.example.test.invalid',
          'mailto:wrong@unrelated-fixture.example.test.invalid',
          'https://contact-fixture.example.test.invalid/contact',
          'published_public',
          'Wrong association',
          'published_verified',
          0.9
        )
      `)
    ).rejects.toThrow(/association is invalid/);

    await expect(
      database.exec(`
        INSERT INTO contacts (
          organization_id,
          source_document_id,
          evidence_id,
          channel_type,
          value,
          normalized_value,
          direct_url,
          source_url,
          origin,
          provenance,
          verification_status,
          verification_provider,
          confidence
        ) VALUES (
          '10000000-0000-4000-8000-000000000096',
          '31000000-0000-4000-8000-000000000096',
          '40000000-0000-4000-8000-000000000096',
          'named_business_email',
          'guessed@contact-fixture.example.test.invalid',
          'guessed@contact-fixture.example.test.invalid',
          'mailto:guessed@contact-fixture.example.test.invalid',
          'https://contact-fixture.example.test.invalid/contact',
          'inferred_pattern',
          'Guessed pattern',
          'provider_verified',
          'fixture',
          0.5
        )
      `)
    ).rejects.toThrow();

    await database.exec(`
      INSERT INTO contact_verifications (
        contact_id,
        status,
        syntax_valid,
        mx_found,
        provider_verdict,
        reason,
        checked_at,
        result_json,
        created_by
      ) VALUES (
        '70000000-0000-4000-8000-000000000096',
        'mx_valid',
        true,
        true,
        'unknown',
        'MX fixture',
        now(),
        '{"status":"mx_valid"}',
        'test'
      )
    `);

    await expect(database.exec("DELETE FROM contact_verifications")).rejects.toThrow(/append-only/);
    await expect(
      database.exec("UPDATE contact_verifications SET reason = 'tampered'")
    ).rejects.toThrow(/append-only/);
  });

  it("enforces immutable message lineage, evidence, website, and latest-version approval", async () => {
    await database.exec(`
      INSERT INTO sources (id, type, name)
      VALUES (
        '30000000-0000-4000-8000-000000000094',
        'secure_fetch',
        'Message fixture'
      );

      INSERT INTO source_documents (
        id, source_id, url, canonical_url, content_hash, trust_level
      ) VALUES (
        '31000000-0000-4000-8000-000000000094',
        '30000000-0000-4000-8000-000000000094',
        'https://message-fixture.example.test.invalid',
        'https://message-fixture.example.test.invalid',
        '${"b".repeat(64)}',
        'primary'
      );

      INSERT INTO organizations (
        id, normalized_name, display_name, canonical_domain, country, stage
      ) VALUES (
        '10000000-0000-4000-8000-000000000094',
        'message fixture',
        'Message Fixture',
        'message-fixture.example.test.invalid',
        'Spain',
        'prelaunch'
      );

      INSERT INTO leads (id, organization_id, status)
      VALUES (
        '20000000-0000-4000-8000-000000000094',
        '10000000-0000-4000-8000-000000000094',
        'contact_found'
      );

      INSERT INTO evidence (
        id,
        lead_id,
        source_document_id,
        fact_type,
        claim,
        quote_or_summary,
        source_url,
        observed_at,
        confidence,
        created_by
      ) VALUES (
        '40000000-0000-4000-8000-000000000094',
        '20000000-0000-4000-8000-000000000094',
        '31000000-0000-4000-8000-000000000094',
        'product',
        'Official product fact',
        'Official product fact',
        'https://message-fixture.example.test.invalid',
        now(),
        1,
        'test'
      );

      INSERT INTO contacts (
        id,
        organization_id,
        source_document_id,
        evidence_id,
        channel_type,
        value,
        normalized_value,
        direct_url,
        source_url,
        origin,
        provenance,
        verification_status,
        confidence
      ) VALUES (
        '70000000-0000-4000-8000-000000000094',
        '10000000-0000-4000-8000-000000000094',
        '31000000-0000-4000-8000-000000000094',
        '40000000-0000-4000-8000-000000000094',
        'corporate_email',
        'hello@message-fixture.example.test.invalid',
        'hello@message-fixture.example.test.invalid',
        'mailto:hello@message-fixture.example.test.invalid',
        'https://message-fixture.example.test.invalid',
        'published_public',
        'Official mailto',
        'published_verified',
        1
      );

      INSERT INTO strategy_briefs (
        id,
        lead_id,
        contact_id,
        language,
        diagnosis,
        opportunity,
        mateo_fit,
        brief_json,
        evidence_ids_json,
        created_by
      ) VALUES (
        '80000000-0000-4000-8000-000000000094',
        '20000000-0000-4000-8000-000000000094',
        '70000000-0000-4000-8000-000000000094',
        'en',
        'Evidence-backed diagnosis',
        'Specific opportunity',
        'integrated operator',
        '{"contactId":"70000000-0000-4000-8000-000000000094","brandName":"Message Fixture","language":"en","evidenceIds":["40000000-0000-4000-8000-000000000094"]}',
        '["40000000-0000-4000-8000-000000000094"]',
        'test'
      );

      INSERT INTO message_drafts (
        id,
        strategy_brief_id,
        lead_id,
        contact_id,
        sequence_step,
        subject,
        body,
        personalization_tokens_json,
        evidence_map_json,
        word_count,
        language,
        qa_json,
        qa_passed,
        created_by
      ) VALUES (
        '90000000-0000-4000-8000-000000000094',
        '80000000-0000-4000-8000-000000000094',
        '20000000-0000-4000-8000-000000000094',
        '70000000-0000-4000-8000-000000000094',
        1,
        'A specific opportunity',
        'Official product fact. Message Fixture has a specific opportunity. InnovatEats: https://innovateats.com',
        '["Message Fixture","specific opportunity"]',
        '[{"textSpan":"Official product fact.","kind":"fact","evidenceIds":["40000000-0000-4000-8000-000000000094"]}]',
        11,
        'en',
        '{"passed":true}',
        true,
        'test'
      );
    `);

    await expect(
      database.exec(`
        INSERT INTO message_drafts (
          strategy_brief_id,
          lead_id,
          contact_id,
          sequence_step,
          body,
          personalization_tokens_json,
          evidence_map_json,
          word_count,
          language,
          qa_json,
          qa_passed,
          created_by
        ) VALUES (
          '80000000-0000-4000-8000-000000000094',
          '20000000-0000-4000-8000-000000000094',
          '70000000-0000-4000-8000-000000000094',
          2,
          'This draft deliberately omits the required site.',
          '["Message Fixture","opportunity"]',
          '[{"textSpan":"Inference","kind":"inference","evidenceIds":[]}]',
          8,
          'en',
          '{"passed":true}',
          true,
          'test'
        )
      `)
    ).rejects.toThrow();

    await database.exec(`
      INSERT INTO message_drafts (
        id,
        strategy_brief_id,
        lead_id,
        contact_id,
        sequence_step,
        subject,
        body,
        personalization_tokens_json,
        evidence_map_json,
        word_count,
        language,
        version,
        supersedes_id,
        edit_source,
        qa_json,
        qa_passed,
        created_by
      ) VALUES (
        '90000000-0000-4000-8000-000000000093',
        '80000000-0000-4000-8000-000000000094',
        '20000000-0000-4000-8000-000000000094',
        '70000000-0000-4000-8000-000000000094',
        1,
        'A refined opportunity',
        'Official product fact. Message Fixture has a refined specific opportunity. InnovatEats: https://innovateats.com',
        '["Message Fixture","specific opportunity"]',
        '[{"textSpan":"Official product fact.","kind":"fact","evidenceIds":["40000000-0000-4000-8000-000000000094"]}]',
        12,
        'en',
        2,
        '90000000-0000-4000-8000-000000000094',
        'human',
        '{"passed":true}',
        true,
        'test'
      );
    `);

    await expect(
      database.exec(`
        INSERT INTO message_approvals (message_draft_id, decision, actor_id)
        VALUES (
          '90000000-0000-4000-8000-000000000094',
          'approved',
          'maateosanchezt@gmail.com'
        )
      `)
    ).rejects.toThrow(/latest message draft version/);

    await database.exec(`
      INSERT INTO message_approvals (message_draft_id, decision, actor_id)
      VALUES (
        '90000000-0000-4000-8000-000000000093',
        'approved',
        'maateosanchezt@gmail.com'
      )
    `);

    await expect(
      database.exec(`
        UPDATE message_drafts
        SET body = 'Tampered https://innovateats.com'
        WHERE id = '90000000-0000-4000-8000-000000000093'
      `)
    ).rejects.toThrow(/immutable and append-only/);
    await expect(database.exec("DELETE FROM strategy_briefs")).rejects.toThrow(
      /immutable and append-only/
    );
    await expect(database.exec("DELETE FROM message_approvals")).rejects.toThrow(/append-only/);
  });
});
