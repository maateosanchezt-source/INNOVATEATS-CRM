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

async function seedApprovedOutreachFixture(
  database: PGlite,
  approveMessages = true
): Promise<void> {
  await database.exec(`
    INSERT INTO sources (id, type, name)
    VALUES ('35000000-0000-4000-8000-000000000001', 'secure_fetch', 'Outreach fixture');

    INSERT INTO source_documents (
      id, source_id, url, canonical_url, content_hash, trust_level
    ) VALUES (
      '35100000-0000-4000-8000-000000000001',
      '35000000-0000-4000-8000-000000000001',
      'https://outreach-fixture.example.test.invalid',
      'https://outreach-fixture.example.test.invalid',
      '${"c".repeat(64)}',
      'primary'
    );

    INSERT INTO organizations (
      id, normalized_name, display_name, canonical_domain, country, stage
    ) VALUES (
      '15000000-0000-4000-8000-000000000001',
      'outreach fixture',
      'Outreach Fixture',
      'outreach-fixture.example.test.invalid',
      'Spain',
      'prelaunch'
    );

    INSERT INTO leads (id, organization_id, status)
    VALUES (
      '25000000-0000-4000-8000-000000000001',
      '15000000-0000-4000-8000-000000000001',
      'approval_pending'
    );

    INSERT INTO evidence (
      id, lead_id, source_document_id, fact_type, claim, quote_or_summary,
      source_url, observed_at, confidence, created_by
    ) VALUES (
      '45000000-0000-4000-8000-000000000001',
      '25000000-0000-4000-8000-000000000001',
      '35100000-0000-4000-8000-000000000001',
      'product',
      'Official product fact',
      'Official product fact',
      'https://outreach-fixture.example.test.invalid',
      now(),
      1,
      'test'
    );

    INSERT INTO contacts (
      id, organization_id, source_document_id, evidence_id, channel_type,
      value, normalized_value, direct_url, source_url, origin, provenance,
      verification_status, confidence
    ) VALUES (
      '75000000-0000-4000-8000-000000000001',
      '15000000-0000-4000-8000-000000000001',
      '35100000-0000-4000-8000-000000000001',
      '45000000-0000-4000-8000-000000000001',
      'corporate_email',
      'hello@outreach-fixture.example.test.invalid',
      'hello@outreach-fixture.example.test.invalid',
      'mailto:hello@outreach-fixture.example.test.invalid',
      'https://outreach-fixture.example.test.invalid',
      'published_public',
      'Official contact page',
      'published_verified',
      1
    );

    INSERT INTO strategy_briefs (
      id, lead_id, contact_id, language, diagnosis, opportunity, mateo_fit,
      brief_json, evidence_ids_json, created_by
    ) VALUES (
      '85000000-0000-4000-8000-000000000001',
      '25000000-0000-4000-8000-000000000001',
      '75000000-0000-4000-8000-000000000001',
      'en',
      'Evidence-backed diagnosis',
      'Specific opportunity',
      'Integrated operator',
      '{"contactId":"75000000-0000-4000-8000-000000000001","brandName":"Outreach Fixture","language":"en","evidenceIds":["45000000-0000-4000-8000-000000000001"]}',
      '["45000000-0000-4000-8000-000000000001"]',
      'test'
    );

    INSERT INTO message_drafts (
      id, strategy_brief_id, lead_id, contact_id, sequence_step, subject, body,
      personalization_tokens_json, evidence_map_json, word_count, language,
      qa_json, qa_passed, created_by
    ) VALUES
    (
      '95000000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001',
      '25000000-0000-4000-8000-000000000001',
      '75000000-0000-4000-8000-000000000001',
      1,
      'A specific opportunity',
      'Official product fact. A useful thought from https://innovateats.com',
      '["Outreach Fixture","specific opportunity"]',
      '[{"textSpan":"Official product fact.","kind":"fact","evidenceIds":["45000000-0000-4000-8000-000000000001"]}]',
      9,
      'en',
      '{"passed":true}',
      true,
      'test'
    ),
    (
      '95000000-0000-4000-8000-000000000002',
      '85000000-0000-4000-8000-000000000001',
      '25000000-0000-4000-8000-000000000001',
      '75000000-0000-4000-8000-000000000001',
      2,
      NULL,
      'Official product fact. Following up from https://innovateats.com',
      '["Outreach Fixture","specific opportunity"]',
      '[{"textSpan":"Official product fact.","kind":"fact","evidenceIds":["45000000-0000-4000-8000-000000000001"]}]',
      8,
      'en',
      '{"passed":true}',
      true,
      'test'
    ),
    (
      '95000000-0000-4000-8000-000000000003',
      '85000000-0000-4000-8000-000000000001',
      '25000000-0000-4000-8000-000000000001',
      '75000000-0000-4000-8000-000000000001',
      3,
      NULL,
      'Official product fact. Closing the loop from https://innovateats.com',
      '["Outreach Fixture","specific opportunity"]',
      '[{"textSpan":"Official product fact.","kind":"fact","evidenceIds":["45000000-0000-4000-8000-000000000001"]}]',
      9,
      'en',
      '{"passed":true}',
      true,
      'test'
    );

    INSERT INTO campaigns (
      id, name, active, sequence_version, approval_mode
    ) VALUES (
      '96000000-0000-4000-8000-000000000001',
      'Outreach fixture campaign',
      true,
      'three-touch-v1',
      'approved_send'
    );

    INSERT INTO senders (
      id, email, display_name, active, sandbox
    ) VALUES (
      '97000000-0000-4000-8000-000000000001',
      'maateosanchezt@gmail.com',
      'Mateo Sanchez / InnovatEats',
      false,
      true
    );
  `);
  if (approveMessages) {
    await database.exec(`
      INSERT INTO message_approvals (message_draft_id, decision, actor_id)
      VALUES
        ('95000000-0000-4000-8000-000000000001', 'approved', 'maateosanchezt@gmail.com'),
        ('95000000-0000-4000-8000-000000000002', 'approved', 'maateosanchezt@gmail.com'),
        ('95000000-0000-4000-8000-000000000003', 'approved', 'maateosanchezt@gmail.com')
    `);
  }
}

async function seedSentOutreachFixture(database: PGlite): Promise<void> {
  await seedApprovedOutreachFixture(database);
  await database.exec(`
    INSERT INTO regions (
      id, code, name, policy_mode, enabled
    ) VALUES (
      '11000000-0000-4000-8000-000000000006',
      'US',
      'United States',
      'approval_required',
      true
    );

    UPDATE organizations
    SET region_id = '11000000-0000-4000-8000-000000000006'
    WHERE id = '15000000-0000-4000-8000-000000000001';

    INSERT INTO region_policy_versions (
      id, region_id, version, policy_json, content_hash, status,
      source_urls_json, approved_by, approved_at, created_by
    ) VALUES (
      '12000000-0000-4000-8000-000000000006',
      '11000000-0000-4000-8000-000000000006',
      'US-test-v1',
      '{"code":"US","version":"US-test-v1"}',
      '${"a".repeat(64)}',
      'active',
      '["https://www.ftc.gov/"]',
      'test',
      now(),
      'test'
    );

    INSERT INTO compliance_decisions (
      id, lead_id, contact_id, campaign_id, region_policy_id,
      region_policy_version, channel, decision, reasons_json, legal_basis_tag,
      input_hash, input_json, output_json, created_by
    ) VALUES (
      '13000000-0000-4000-8000-000000000006',
      '25000000-0000-4000-8000-000000000001',
      '75000000-0000-4000-8000-000000000001',
      '96000000-0000-4000-8000-000000000001',
      '12000000-0000-4000-8000-000000000006',
      'US-test-v1',
      'email',
      'approval_required',
      '["human approval required"]',
      'can_spam',
      '${"b".repeat(64)}',
      '{}',
      '{"decision":"approval_required"}',
      'test'
    );

    UPDATE senders
    SET active = true
    WHERE id = '97000000-0000-4000-8000-000000000001';

    INSERT INTO gmail_credentials (
      sender_id, version, encrypted_refresh_token, scopes_json, granted_by
    ) VALUES (
      '97000000-0000-4000-8000-000000000001',
      1,
      'v1.iv.tag.ciphertext',
      '[
        "openid",
        "email",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.readonly"
      ]',
      'maateosanchezt@gmail.com'
    );

    INSERT INTO sequences (
      id, lead_id, contact_id, campaign_id, sender_id, workflow_id,
      recipient_timezone, delivery_mode, compliance_decision_id, created_by
    ) VALUES (
      '98000000-0000-4000-8000-000000000006',
      '25000000-0000-4000-8000-000000000001',
      '75000000-0000-4000-8000-000000000001',
      '96000000-0000-4000-8000-000000000001',
      '97000000-0000-4000-8000-000000000001',
      'outreach-sequence:98000000-0000-4000-8000-000000000006',
      'Europe/Madrid',
      'production',
      '13000000-0000-4000-8000-000000000006',
      'maateosanchezt@gmail.com'
    );

    INSERT INTO outbound_messages (
      id, sequence_id, message_draft_id, sequence_step, internet_message_id,
      idempotency_key, scheduled_at, decision_trace_json
    ) VALUES (
      '99000000-0000-4000-8000-000000000006',
      '98000000-0000-4000-8000-000000000006',
      '95000000-0000-4000-8000-000000000001',
      1,
      '<fixture-inbound@outreach.innovateats.com>',
      '96000000-0000-4000-8000-000000000001:25000000-0000-4000-8000-000000000001:1:email',
      now(),
      '{"requiredWebsite":"https://innovateats.com"}'
    );

    UPDATE outbound_messages
    SET delivery_status = 'sending', claimed_at = now(), attempt_count = 1
    WHERE id = '99000000-0000-4000-8000-000000000006';

    UPDATE outbound_messages
    SET
      delivery_status = 'sent',
      sent_at = now(),
      provider_message_id = 'gmail-outbound-6',
      thread_id = 'gmail-thread-6'
    WHERE id = '99000000-0000-4000-8000-000000000006';

    UPDATE leads
    SET status = 'contacted'
    WHERE id = '25000000-0000-4000-8000-000000000001';
  `);
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
          'message_approvals',
          'campaigns',
          'compliance_decisions',
          'discovery_campaigns',
          'discovery_candidate_sources',
          'discovery_candidates',
          'discovery_provider_actions',
          'discovery_runs',
          'discovery_seeds',
          'senders',
          'gmail_oauth_states',
          'gmail_credentials',
          'suppression_list',
          'sequences',
          'outbound_messages',
          'send_attempts',
          'outbox_events',
          'gmail_sync_cursors',
          'inbound_messages',
          'reply_classifications',
          'handoffs',
          'internal_notifications',
          'recheck_tasks',
          'region_policy_versions',
          'social_manual_queue'
        )
      ORDER BY table_name
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "account",
      "agent_runs",
      "audit_log",
      "campaigns",
      "compliance_decisions",
      "contact_verifications",
      "contacts",
      "discovery_campaigns",
      "discovery_candidate_sources",
      "discovery_candidates",
      "discovery_provider_actions",
      "discovery_runs",
      "discovery_seeds",
      "evidence",
      "feature_flags",
      "founders",
      "gmail_credentials",
      "gmail_oauth_states",
      "gmail_sync_cursors",
      "handoffs",
      "inbound_messages",
      "internal_notifications",
      "kill_switches",
      "lead_scores",
      "lead_status_history",
      "leads",
      "message_approvals",
      "message_drafts",
      "organizations",
      "outbound_messages",
      "outbox_events",
      "recheck_tasks",
      "region_policy_versions",
      "reply_classifications",
      "send_attempts",
      "senders",
      "sequences",
      "session",
      "social_manual_queue",
      "source_documents",
      "sources",
      "strategy_briefs",
      "suppression_list",
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

  it("protects discovery provenance, provider actions, and one-way decisions", async () => {
    await database.exec(`
      INSERT INTO regions (
        id, code, name, policy_mode, enabled
      ) VALUES (
        'd1000000-0000-4000-8000-000000000001',
        'DISCOVERY_TEST',
        'Discovery test',
        'draft_only',
        true
      );

      INSERT INTO discovery_campaigns (
        id, name, region_id, created_by
      ) VALUES (
        'd2000000-0000-4000-8000-000000000001',
        'Discovery fixture',
        'd1000000-0000-4000-8000-000000000001',
        'test'
      );

      INSERT INTO discovery_seeds (
        id, campaign_id, kind, value, normalized_value, track
      ) VALUES (
        'd3000000-0000-4000-8000-000000000001',
        'd2000000-0000-4000-8000-000000000001',
        'keyword',
        'food startup Spain',
        'food startup spain',
        'food_brand'
      );

      INSERT INTO discovery_runs (
        id, campaign_id, workflow_id, idempotency_key, trigger, queued_by
      ) VALUES (
        'd4000000-0000-4000-8000-000000000001',
        'd2000000-0000-4000-8000-000000000001',
        'instagram-discovery:d4000000-0000-4000-8000-000000000001',
        'test:d4000000-0000-4000-8000-000000000001',
        'manual',
        'test'
      );

      INSERT INTO discovery_provider_actions (
        id, run_id, seed_id, action_key, provider, actor_id, input_hash,
        status, provider_run_id, dataset_id, item_count, started_at, completed_at
      ) VALUES (
        'd5000000-0000-4000-8000-000000000001',
        'd4000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000001',
        'fixture-action',
        'apify',
        'fixture-actor',
        '${"d".repeat(64)}',
        'succeeded',
        'fixture-provider-run',
        'fixture-dataset',
        1,
        now(),
        now()
      );

      INSERT INTO discovery_candidates (
        id, campaign_id, first_run_id, username, profile_url, track, snapshot_json
      ) VALUES (
        'd6000000-0000-4000-8000-000000000001',
        'd2000000-0000-4000-8000-000000000001',
        'd4000000-0000-4000-8000-000000000001',
        'fixture.food',
        'https://www.instagram.com/fixture.food/',
        'food_brand',
        '{"username":"fixture.food"}'
      );

      INSERT INTO discovery_candidate_sources (
        candidate_id, run_id, seed_id, provider, provider_result_id
      ) VALUES (
        'd6000000-0000-4000-8000-000000000001',
        'd4000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000001',
        'apify',
        'fixture-result'
      );
    `);

    await expect(
      database.exec(`
        UPDATE discovery_provider_actions
        SET item_count = 2
        WHERE id = 'd5000000-0000-4000-8000-000000000001'
      `)
    ).rejects.toThrow(/completion is immutable/);
    await expect(database.exec("DELETE FROM discovery_candidate_sources")).rejects.toThrow(
      /append-only/
    );

    await database.exec(`
      UPDATE discovery_candidates
      SET
        status = 'approved',
        decision_reason = 'Matches the food startup ICP',
        decided_by = 'test',
        decided_at = now()
      WHERE id = 'd6000000-0000-4000-8000-000000000001'
    `);
    await expect(
      database.exec(`
        UPDATE discovery_candidates
        SET status = 'rejected'
        WHERE id = 'd6000000-0000-4000-8000-000000000001'
      `)
    ).rejects.toThrow(/decision is one-way/);
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

  it("enforces encrypted append-only Gmail grants", async () => {
    await seedApprovedOutreachFixture(database);
    await expect(
      database.exec(`
        INSERT INTO gmail_credentials (
          sender_id, version, encrypted_refresh_token, scopes_json, granted_by
        ) VALUES (
          '97000000-0000-4000-8000-000000000001',
          1,
          'plaintext-token',
          '["https://www.googleapis.com/auth/gmail.send"]',
          'test'
        )
      `)
    ).rejects.toThrow();

    await database.exec(`
      INSERT INTO gmail_credentials (
        sender_id, version, encrypted_refresh_token, scopes_json, granted_by
      ) VALUES (
        '97000000-0000-4000-8000-000000000001',
        1,
        'v1.iv.tag.ciphertext',
        '["openid","email","https://www.googleapis.com/auth/gmail.send"]',
        'maateosanchezt@gmail.com'
      )
    `);
    await expect(
      database.exec("UPDATE gmail_credentials SET granted_by = 'tampered'")
    ).rejects.toThrow(/append-only/);
    await expect(database.exec("DELETE FROM gmail_credentials")).rejects.toThrow(/append-only/);
  });

  it("binds an outbound to the latest approval and permits only safe delivery transitions", async () => {
    await seedApprovedOutreachFixture(database);
    await database.exec(`
      INSERT INTO sequences (
        id, lead_id, contact_id, campaign_id, sender_id, workflow_id,
        recipient_timezone, delivery_mode, created_by
      ) VALUES (
        '98000000-0000-4000-8000-000000000001',
        '25000000-0000-4000-8000-000000000001',
        '75000000-0000-4000-8000-000000000001',
        '96000000-0000-4000-8000-000000000001',
        '97000000-0000-4000-8000-000000000001',
        'outreach-sequence:98000000-0000-4000-8000-000000000001',
        'Europe/Madrid',
        'dry_run',
        'maateosanchezt@gmail.com'
      );

      INSERT INTO outbound_messages (
        id, sequence_id, message_draft_id, sequence_step, internet_message_id,
        idempotency_key, scheduled_at, decision_trace_json
      ) VALUES (
        '99000000-0000-4000-8000-000000000001',
        '98000000-0000-4000-8000-000000000001',
        '95000000-0000-4000-8000-000000000001',
        1,
        '<fixture-1@outreach.innovateats.com>',
        '96000000-0000-4000-8000-000000000001:25000000-0000-4000-8000-000000000001:1:email',
        now(),
        '{"requiredWebsite":"https://innovateats.com"}'
      );
    `);

    await expect(
      database.exec(`
        UPDATE outbound_messages
        SET delivery_status = 'sent'
        WHERE id = '99000000-0000-4000-8000-000000000001'
      `)
    ).rejects.toThrow(/transition is invalid/);

    await database.exec(`
      UPDATE outbound_messages
      SET delivery_status = 'sending', claimed_at = now(), attempt_count = 1
      WHERE id = '99000000-0000-4000-8000-000000000001';
      UPDATE outbound_messages
      SET delivery_status = 'dry_run'
      WHERE id = '99000000-0000-4000-8000-000000000001';
    `);
    await expect(database.exec("DELETE FROM outbound_messages")).rejects.toThrow(
      /cannot be deleted physically/
    );
    await expect(
      database.exec(`
        INSERT INTO outbound_messages (
          sequence_id, message_draft_id, sequence_step, internet_message_id,
          idempotency_key, scheduled_at, decision_trace_json
        ) VALUES (
          '98000000-0000-4000-8000-000000000001',
          '95000000-0000-4000-8000-000000000002',
          2,
          '<fixture-2@outreach.innovateats.com>',
          'wrong-key',
          now(),
          '{}'
        )
      `)
    ).rejects.toThrow(/association or idempotency is invalid/);
  });

  it("rejects every external sequence that has no matching compliance decision", async () => {
    await seedApprovedOutreachFixture(database);
    await expect(
      database.exec(`
        INSERT INTO sequences (
          lead_id, contact_id, campaign_id, sender_id, workflow_id,
          recipient_timezone, delivery_mode, created_by
        ) VALUES (
          '25000000-0000-4000-8000-000000000001',
          '75000000-0000-4000-8000-000000000001',
          '96000000-0000-4000-8000-000000000001',
          '97000000-0000-4000-8000-000000000001',
          'outreach-sequence:missing-compliance',
          'Europe/Madrid',
          'production',
          'maateosanchezt@gmail.com'
        )
      `)
    ).rejects.toThrow(/require a compliance decision/);
  });

  it("protects policy decisions and keeps platform work manual and one-way", async () => {
    await seedApprovedOutreachFixture(database);
    await database.exec(`
      INSERT INTO regions (
        id, code, name, policy_mode, enabled
      ) VALUES (
        '11000000-0000-4000-8000-000000000007',
        'US',
        'United States',
        'approval_required',
        false
      );

      UPDATE organizations
      SET region_id = '11000000-0000-4000-8000-000000000007'
      WHERE id = '15000000-0000-4000-8000-000000000001';

      INSERT INTO region_policy_versions (
        id, region_id, version, policy_json, content_hash, status,
        source_urls_json, approved_by, approved_at, created_by
      ) VALUES (
        '12000000-0000-4000-8000-000000000007',
        '11000000-0000-4000-8000-000000000007',
        'US-test-manual-v1',
        '{"code":"US","version":"US-test-manual-v1"}',
        '${"a".repeat(64)}',
        'active',
        '["https://www.ftc.gov/"]',
        'test',
        now(),
        'test'
      );

      INSERT INTO contacts (
        id, organization_id, source_document_id, evidence_id, channel_type,
        value, normalized_value, direct_url, source_url, origin, provenance,
        verification_status, confidence
      ) VALUES (
        '75000000-0000-4000-8000-000000000007',
        '15000000-0000-4000-8000-000000000001',
        '35100000-0000-4000-8000-000000000001',
        '45000000-0000-4000-8000-000000000001',
        'linkedin',
        'https://www.linkedin.com/company/example',
        'https://www.linkedin.com/company/example',
        'https://www.linkedin.com/company/example',
        'https://outreach-fixture.example.test.invalid',
        'published_public',
        'Official public profile',
        'published_verified',
        1
      );

      INSERT INTO compliance_decisions (
        id, lead_id, contact_id, campaign_id, region_policy_id,
        region_policy_version, channel, decision, reasons_json, legal_basis_tag,
        input_hash, input_json, output_json, created_by
      ) VALUES (
        '13000000-0000-4000-8000-000000000007',
        '25000000-0000-4000-8000-000000000001',
        '75000000-0000-4000-8000-000000000007',
        '96000000-0000-4000-8000-000000000001',
        '12000000-0000-4000-8000-000000000007',
        'US-test-manual-v1',
        'linkedin',
        'draft_only',
        '["manual platform action only"]',
        'platform_manual_only',
        '${"b".repeat(64)}',
        '{}',
        '{"decision":"draft_only"}',
        'test'
      );

      INSERT INTO social_manual_queue (
        id, lead_id, contact_id, compliance_decision_id, channel,
        direct_url, message, created_by
      ) VALUES (
        '14000000-0000-4000-8000-000000000007',
        '25000000-0000-4000-8000-000000000001',
        '75000000-0000-4000-8000-000000000007',
        '13000000-0000-4000-8000-000000000007',
        'linkedin',
        'https://www.linkedin.com/company/example',
        'Manual draft https://innovateats.com',
        'test'
      );
    `);

    await expect(
      database.exec(`
        UPDATE region_policy_versions
        SET policy_json = '{"tampered":true}'
        WHERE id = '12000000-0000-4000-8000-000000000007'
      `)
    ).rejects.toThrow(/immutable/);
    await expect(
      database.exec(`
        UPDATE compliance_decisions
        SET decision = 'allow'
        WHERE id = '13000000-0000-4000-8000-000000000007'
      `)
    ).rejects.toThrow(/append-only/);
    await expect(
      database.exec(`
        UPDATE social_manual_queue
        SET message = 'Changed draft'
        WHERE id = '14000000-0000-4000-8000-000000000007'
      `)
    ).rejects.toThrow(/immutable/);
    await expect(
      database.exec(`
        UPDATE social_manual_queue
        SET automatic_action_attempted = true
        WHERE id = '14000000-0000-4000-8000-000000000007'
      `)
    ).rejects.toThrow();

    await database.exec(`
      UPDATE social_manual_queue
      SET status = 'copied', copied_at = now()
      WHERE id = '14000000-0000-4000-8000-000000000007';

      UPDATE social_manual_queue
      SET status = 'marked_sent', marked_sent_at = now()
      WHERE id = '14000000-0000-4000-8000-000000000007';
    `);
    await expect(
      database.exec(`
        UPDATE social_manual_queue
        SET status = 'cancelled', marked_sent_at = NULL
        WHERE id = '14000000-0000-4000-8000-000000000007'
      `)
    ).rejects.toThrow(/one-way/);
  });

  it("blocks scheduling after a contact enters the immutable suppression list", async () => {
    await seedApprovedOutreachFixture(database, false);
    await database.exec(`
      INSERT INTO suppression_list (
        normalized_contact, contact_hash, channel, reason, source, created_by
      ) VALUES (
        'hello@outreach-fixture.example.test.invalid',
        '${"d".repeat(64)}',
        'email',
        'unsubscribe',
        'fixture',
        'test'
      )
    `);
    await expect(
      database.exec(`
        INSERT INTO message_approvals (message_draft_id, decision, actor_id)
        VALUES (
          '95000000-0000-4000-8000-000000000001',
          'approved',
          'maateosanchezt@gmail.com'
        )
      `)
    ).rejects.toThrow(/suppressed contact/);
    await expect(
      database.exec(`
        INSERT INTO sequences (
          lead_id, contact_id, campaign_id, sender_id, workflow_id,
          recipient_timezone, delivery_mode, created_by
        ) VALUES (
          '25000000-0000-4000-8000-000000000001',
          '75000000-0000-4000-8000-000000000001',
          '96000000-0000-4000-8000-000000000001',
          '97000000-0000-4000-8000-000000000001',
          'outreach-sequence:suppressed-fixture',
          'Europe/Madrid',
          'dry_run',
          'maateosanchezt@gmail.com'
        )
      `)
    ).rejects.toThrow(/suppressed contact/);
    await expect(database.exec("DELETE FROM suppression_list")).rejects.toThrow(/append-only/);
  });

  it("accepts only replies from a sent CRM thread and protects the handoff record", async () => {
    await seedSentOutreachFixture(database);
    await database.exec(`
      INSERT INTO gmail_sync_cursors (sender_id, history_id)
      VALUES ('97000000-0000-4000-8000-000000000001', '100');

      INSERT INTO inbound_messages (
        id, provider_message_id, thread_id, sender_id, sequence_id, lead_id,
        association_type, from_address, to_address, subject, body_text, body_hash, received_at
      ) VALUES (
        '91000000-0000-4000-8000-000000000006',
        'gmail-inbound-6',
        'gmail-thread-6',
        '97000000-0000-4000-8000-000000000001',
        '98000000-0000-4000-8000-000000000006',
        '25000000-0000-4000-8000-000000000001',
        'contact_reply',
        'hello@outreach-fixture.example.test.invalid',
        'maateosanchezt@gmail.com',
        'Re: A specific opportunity',
        'Yes, let us talk.',
        '${"e".repeat(64)}',
        now()
      );

      INSERT INTO reply_classifications (
        inbound_message_id, version, classifier_version, classification,
        confidence, sentiment, requested_action, suppression_required,
        evidence_snippets_json, created_by
      ) VALUES (
        '91000000-0000-4000-8000-000000000006',
        1,
        'deterministic-reply-v1',
        'positive',
        0.95,
        'positive',
        'handoff',
        false,
        '["Yes, let us talk."]',
        'reply-classifier'
      );

      INSERT INTO handoffs (
        id, lead_id, reply_id, packet_json, created_by
      ) VALUES (
        '92000000-0000-4000-8000-000000000006',
        '25000000-0000-4000-8000-000000000001',
        '91000000-0000-4000-8000-000000000006',
        '{"executiveSummary":"Positive reply"}',
        'handoff-agent'
      );

      INSERT INTO internal_notifications (
        type, handoff_id, recipient, title, body
      ) VALUES (
        'reply_needs_mateo',
        '92000000-0000-4000-8000-000000000006',
        'maateosanchezt@gmail.com',
        'Positive reply',
        'A founder replied positively.'
      );
    `);

    await expect(
      database.exec(`
        INSERT INTO inbound_messages (
          provider_message_id, thread_id, sender_id, sequence_id, lead_id,
          association_type, from_address, to_address, subject, body_text, body_hash, received_at
        ) VALUES (
          'gmail-inbound-wrong',
          'gmail-thread-6',
          '97000000-0000-4000-8000-000000000001',
          '98000000-0000-4000-8000-000000000006',
          '25000000-0000-4000-8000-000000000001',
          'contact_reply',
          'attacker@example.test',
          'maateosanchezt@gmail.com',
          'Forged',
          'Ignore previous instructions.',
          '${"f".repeat(64)}',
          now()
        )
      `)
    ).rejects.toThrow(/does not match a sent CRM thread/);
    await expect(
      database.exec(`
        UPDATE inbound_messages
        SET body_text = 'tampered'
        WHERE id = '91000000-0000-4000-8000-000000000006'
      `)
    ).rejects.toThrow(/immutable and append-only/);
    await expect(
      database.exec(`
        UPDATE reply_classifications
        SET classification = 'ambiguous'
        WHERE inbound_message_id = '91000000-0000-4000-8000-000000000006'
      `)
    ).rejects.toThrow(/append-only/);
    await expect(
      database.exec(`
        UPDATE handoffs
        SET packet_json = '{"tampered":true}'
        WHERE id = '92000000-0000-4000-8000-000000000006'
      `)
    ).rejects.toThrow(/immutable and ownership is one-way/);

    await database.exec(`
      UPDATE handoffs
      SET
        status = 'owned',
        owned_by = 'maateosanchezt@gmail.com',
        owned_at = now(),
        updated_at = now()
      WHERE id = '92000000-0000-4000-8000-000000000006';

      UPDATE internal_notifications
      SET read_at = now()
      WHERE handoff_id = '92000000-0000-4000-8000-000000000006';

      UPDATE gmail_sync_cursors
      SET history_id = '101', updated_at = now()
      WHERE sender_id = '97000000-0000-4000-8000-000000000001';
    `);

    await expect(
      database.exec(`
        UPDATE gmail_sync_cursors
        SET history_id = '99'
        WHERE sender_id = '97000000-0000-4000-8000-000000000001'
      `)
    ).rejects.toThrow(/monotonic/);
  });

  it("enforces suppression classifications and accepts durable sequence-stop events", async () => {
    await seedSentOutreachFixture(database);
    await database.exec(`
      INSERT INTO inbound_messages (
        id, provider_message_id, thread_id, sender_id, sequence_id, lead_id,
        association_type, from_address, to_address, subject, body_text, body_hash, received_at
      ) VALUES (
        '91000000-0000-4000-8000-000000000007',
        'gmail-inbound-7',
        'gmail-thread-6',
        '97000000-0000-4000-8000-000000000001',
        '98000000-0000-4000-8000-000000000006',
        '25000000-0000-4000-8000-000000000001',
        'provider_bounce',
        'mailer-daemon@googlemail.com',
        'maateosanchezt@gmail.com',
        'Delivery failed',
        'Permanent failure.',
        '${"a".repeat(64)}',
        now()
      );

      INSERT INTO reply_classifications (
        inbound_message_id, version, classifier_version, classification,
        confidence, sentiment, requested_action, suppression_required,
        evidence_snippets_json, created_by
      ) VALUES (
        '91000000-0000-4000-8000-000000000007',
        1,
        'deterministic-reply-v1',
        'bounce',
        0.99,
        'automated',
        'suppress',
        true,
        '["Permanent failure."]',
        'reply-classifier'
      );

      INSERT INTO outbox_events (
        event_type, aggregate_type, aggregate_id, idempotency_key, payload_json
      ) VALUES (
        'sequence.stop',
        'sequence',
        '98000000-0000-4000-8000-000000000006',
        'sequence.stop:gmail-inbound-7',
        '{
          "sequenceId":"98000000-0000-4000-8000-000000000006",
          "workflowId":"outreach-sequence:98000000-0000-4000-8000-000000000006",
          "reason":"bounce"
        }'
      );
    `);

    await expect(
      database.exec(`
        INSERT INTO reply_classifications (
          inbound_message_id, version, classifier_version, classification,
          confidence, sentiment, requested_action, suppression_required,
          evidence_snippets_json, created_by
        ) VALUES (
          '91000000-0000-4000-8000-000000000007',
          2,
          'unsafe',
          'unsubscribe',
          1,
          'negative',
          'suppress',
          false,
          '[]',
          'unsafe'
        )
      `)
    ).rejects.toThrow();
  });

  it("enforces immutable evaluation snapshots and a closed controlled pilot", async () => {
    const checklist = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM go_live_checklist_items"
    );
    expect(checklist.rows[0]?.count).toBe(14);

    await database.exec(`
      INSERT INTO prompt_versions (
        id, agent_name, version, content_hash, configuration_json, created_by
      ) VALUES (
        'a1000000-0000-4000-8000-000000000008',
        'copy',
        'copy-eval-v1',
        '${"a".repeat(64)}',
        '{"modelRoute":"OPENAI_COPY_MODEL"}',
        'test'
      );
    `);
    await expect(
      database.exec(`
        UPDATE prompt_versions
        SET configuration_json = '{"tampered":true}'
        WHERE id = 'a1000000-0000-4000-8000-000000000008'
      `)
    ).rejects.toThrow(/immutable/);
    await database.exec(`
      UPDATE prompt_versions
      SET
        status = 'active',
        approved_by = 'maateosanchezt@gmail.com',
        approved_at = now()
      WHERE id = 'a1000000-0000-4000-8000-000000000008';

      INSERT INTO eval_runs (
        id, suite_version, dataset_version, started_by
      ) VALUES (
        'a2000000-0000-4000-8000-000000000008',
        'pilot-evals-v1',
        'pilot-leads-v1',
        'maateosanchezt@gmail.com'
      );

      UPDATE eval_runs
      SET
        status = 'passed',
        report_json = '{"automatedPassed":true,"pilotReady":false}',
        automated_passed = true,
        pilot_ready = false,
        completed_at = now()
      WHERE id = 'a2000000-0000-4000-8000-000000000008';
    `);
    await expect(
      database.exec(`
        UPDATE eval_runs
        SET pilot_ready = true
        WHERE id = 'a2000000-0000-4000-8000-000000000008'
      `)
    ).rejects.toThrow(/one-way/);

    await expect(
      database.exec(`
        INSERT INTO pilot_runs (
          name, mode, status, allowed_regions_json, starts_at, ends_at,
          external_authorized, created_by
        ) VALUES (
          'Unsafe production pilot',
          'production',
          'planned',
          '["US","UK"]',
          now(),
          now() + interval '14 days',
          false,
          'test'
        )
      `)
    ).rejects.toThrow();
    await expect(
      database.exec(`
        INSERT INTO pilot_runs (
          name, allowed_regions_json, daily_email_cap, starts_at, ends_at, created_by
        ) VALUES (
          'Unsafe oversized pilot',
          '["US","UK"]',
          11,
          now(),
          now() + interval '14 days',
          'test'
        )
      `)
    ).rejects.toThrow();

    await database.exec(`
      INSERT INTO pilot_runs (
        id, name, mode, status, allowed_regions_json, starts_at, ends_at, created_by
      ) VALUES (
        'a3000000-0000-4000-8000-000000000008',
        'Controlled simulation',
        'simulation',
        'running',
        '["US","UK"]',
        now(),
        now() + interval '14 days',
        'maateosanchezt@gmail.com'
      );

      INSERT INTO pilot_review_checkpoints (
        id, pilot_run_id, after_message_count, metrics_json, decision, notes, reviewed_by
      ) VALUES (
        'a4000000-0000-4000-8000-000000000008',
        'a3000000-0000-4000-8000-000000000008',
        20,
        '{"bounceRate":0}',
        'continue',
        'First required review',
        'maateosanchezt@gmail.com'
      );
    `);
    await expect(
      database.exec(`
        UPDATE pilot_review_checkpoints
        SET notes = 'tampered'
        WHERE id = 'a4000000-0000-4000-8000-000000000008'
      `)
    ).rejects.toThrow(/append-only/);
    await expect(
      database.exec(`
        INSERT INTO pilot_review_checkpoints (
          pilot_run_id, after_message_count, metrics_json, decision, notes, reviewed_by
        ) VALUES (
          'a3000000-0000-4000-8000-000000000008',
          10,
          '{}',
          'continue',
          'Too early',
          'test'
        )
      `)
    ).rejects.toThrow();
  });

  it("requires evidence for go-live reviews and exact human quality averages", async () => {
    await expect(
      database.exec(`
        UPDATE go_live_checklist_items
        SET
          status = 'passed',
          reviewed_by = 'maateosanchezt@gmail.com',
          reviewed_at = now()
        WHERE key = 'spf'
      `)
    ).rejects.toThrow();
    await database.exec(`
      UPDATE go_live_checklist_items
      SET
        status = 'blocked',
        evidence_json = '{"reason":"DNS evidence not supplied"}',
        reviewed_by = 'maateosanchezt@gmail.com',
        reviewed_at = now()
      WHERE key = 'spf';
    `);
    const spf = await database.query<{ status: string }>(
      "SELECT status FROM go_live_checklist_items WHERE key = 'spf'"
    );
    expect(spf.rows[0]?.status).toBe("blocked");

    await seedApprovedOutreachFixture(database);
    await expect(
      database.exec(`
        INSERT INTO message_quality_reviews (
          message_draft_id, research_accuracy, opportunity_insight, innovateats_fit,
          mateo_credibility, naturalness, cta_quality, risk_safety, average_score,
          notes, reviewed_by
        ) VALUES (
          '95000000-0000-4000-8000-000000000001',
          5, 4, 4, 5, 4, 5, 5, 5,
          'Wrong average',
          'maateosanchezt@gmail.com'
        )
      `)
    ).rejects.toThrow();
    await database.exec(`
      INSERT INTO message_quality_reviews (
        id, message_draft_id, research_accuracy, opportunity_insight, innovateats_fit,
        mateo_credibility, naturalness, cta_quality, risk_safety, average_score,
        notes, reviewed_by
      ) VALUES (
        'a5000000-0000-4000-8000-000000000008',
        '95000000-0000-4000-8000-000000000001',
        5, 4, 4, 5, 4, 5, 5, 4.57,
        'Reviewed against the seven-part rubric',
        'maateosanchezt@gmail.com'
      );
    `);
    await expect(
      database.exec(`
        DELETE FROM message_quality_reviews
        WHERE id = 'a5000000-0000-4000-8000-000000000008'
      `)
    ).rejects.toThrow(/append-only/);
  });
});
