CREATE TABLE strategy_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  language text NOT NULL,
  diagnosis text NOT NULL,
  opportunity text NOT NULL,
  mateo_fit text NOT NULL,
  brief_json jsonb NOT NULL,
  evidence_ids_json jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  supersedes_id uuid REFERENCES strategy_briefs(id) ON DELETE RESTRICT,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strategy_brief_language_known CHECK (language IN ('en', 'es')),
  CONSTRAINT strategy_brief_version_positive CHECK (version > 0),
  CONSTRAINT strategy_brief_evidence_array CHECK (
    jsonb_typeof(evidence_ids_json) = 'array'
    AND jsonb_array_length(evidence_ids_json) > 0
  )
);

CREATE UNIQUE INDEX strategy_briefs_supersedes_unique
  ON strategy_briefs (supersedes_id)
  WHERE supersedes_id IS NOT NULL;
CREATE INDEX strategy_briefs_lead_created_index
  ON strategy_briefs (lead_id, created_at);

CREATE OR REPLACE FUNCTION validate_strategy_brief()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  lead_organization_id uuid;
  lead_brand_name text;
  invalid_evidence_count integer;
BEGIN
  SELECT l.organization_id, o.display_name
  INTO lead_organization_id, lead_brand_name
  FROM leads l
  JOIN organizations o ON o.id = l.organization_id
  WHERE l.id = NEW.lead_id;

  IF lead_organization_id IS NULL THEN
    RAISE EXCEPTION 'strategy brief lead does not exist';
  END IF;

  IF NEW.brief_json->>'contactId' IS DISTINCT FROM NEW.contact_id::text
    OR NEW.brief_json->>'brandName' IS DISTINCT FROM lead_brand_name
    OR NEW.brief_json->>'language' IS DISTINCT FROM NEW.language
    OR NEW.brief_json->'evidenceIds' IS DISTINCT FROM NEW.evidence_ids_json
  THEN
    RAISE EXCEPTION 'strategy brief columns do not match the typed brief or lead brand';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM contacts c
    WHERE c.id = NEW.contact_id
      AND c.organization_id = lead_organization_id
      AND c.channel_type IN ('corporate_email', 'named_business_email')
      AND c.do_not_contact = false
      AND c.origin <> 'inferred_pattern'
      AND (
        c.verification_status IN ('published_verified', 'provider_verified')
        OR (
          c.origin = 'data_broker'
          AND c.verification_status = 'provider_verified'
        )
      )
  ) THEN
    RAISE EXCEPTION 'strategy brief requires an actionable email contact on the lead organization';
  END IF;

  SELECT count(*)
  INTO invalid_evidence_count
  FROM jsonb_array_elements_text(NEW.evidence_ids_json) AS cited(evidence_id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM evidence e
    WHERE e.id = cited.evidence_id::uuid
      AND e.lead_id = NEW.lead_id
      AND e.state = 'active'
  );

  IF invalid_evidence_count > 0 THEN
    RAISE EXCEPTION 'strategy brief evidence must be active and belong to the lead';
  END IF;

  IF NEW.supersedes_id IS NULL AND NEW.version <> 1 THEN
    RAISE EXCEPTION 'initial strategy brief version must be 1';
  END IF;

  IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM strategy_briefs previous
    WHERE previous.id = NEW.supersedes_id
      AND previous.lead_id = NEW.lead_id
      AND previous.contact_id = NEW.contact_id
      AND NEW.version = previous.version + 1
  ) THEN
    RAISE EXCEPTION 'strategy brief version lineage is invalid';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER strategy_brief_association_valid
BEFORE INSERT ON strategy_briefs
FOR EACH ROW
EXECUTE FUNCTION validate_strategy_brief();

CREATE OR REPLACE FUNCTION protect_strategy_brief()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'strategy briefs are immutable and append-only';
END;
$$;

CREATE TRIGGER strategy_briefs_append_only
BEFORE UPDATE OR DELETE ON strategy_briefs
FOR EACH ROW
EXECUTE FUNCTION protect_strategy_brief();

CREATE TABLE message_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_brief_id uuid NOT NULL REFERENCES strategy_briefs(id) ON DELETE RESTRICT,
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  channel text NOT NULL DEFAULT 'email',
  sequence_step integer NOT NULL,
  subject text,
  body text NOT NULL,
  personalization_tokens_json jsonb NOT NULL,
  evidence_map_json jsonb NOT NULL,
  word_count integer NOT NULL,
  language text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  supersedes_id uuid REFERENCES message_drafts(id) ON DELETE RESTRICT,
  edit_source text NOT NULL DEFAULT 'agent',
  qa_json jsonb NOT NULL,
  qa_passed boolean NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_draft_channel_email CHECK (channel = 'email'),
  CONSTRAINT message_draft_sequence_step CHECK (sequence_step BETWEEN 1 AND 3),
  CONSTRAINT message_draft_subject_shape CHECK (
    (sequence_step = 1 AND subject IS NOT NULL)
    OR (sequence_step > 1 AND subject IS NULL)
  ),
  CONSTRAINT message_draft_language_known CHECK (language IN ('en', 'es')),
  CONSTRAINT message_draft_version_positive CHECK (version > 0),
  CONSTRAINT message_draft_word_count_positive CHECK (word_count > 0),
  CONSTRAINT message_draft_edit_source_known CHECK (edit_source IN ('agent', 'human')),
  CONSTRAINT message_draft_required_website CHECK (
    position('https://innovateats.com' in body) > 0
  ),
  CONSTRAINT message_draft_personalization_array CHECK (
    jsonb_typeof(personalization_tokens_json) = 'array'
    AND jsonb_array_length(personalization_tokens_json) >= 2
  ),
  CONSTRAINT message_draft_evidence_map_array CHECK (
    jsonb_typeof(evidence_map_json) = 'array'
    AND jsonb_array_length(evidence_map_json) > 0
  )
);

CREATE UNIQUE INDEX message_drafts_brief_step_version_unique
  ON message_drafts (strategy_brief_id, sequence_step, version);
CREATE UNIQUE INDEX message_drafts_supersedes_unique
  ON message_drafts (supersedes_id)
  WHERE supersedes_id IS NOT NULL;
CREATE INDEX message_drafts_lead_step_created_index
  ON message_drafts (lead_id, sequence_step, created_at);

CREATE OR REPLACE FUNCTION validate_message_draft()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evidence_item jsonb;
  cited_evidence_id text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM strategy_briefs brief
    WHERE brief.id = NEW.strategy_brief_id
      AND brief.lead_id = NEW.lead_id
      AND brief.contact_id = NEW.contact_id
      AND brief.language = NEW.language
  ) THEN
    RAISE EXCEPTION 'message draft brief/lead/contact association is invalid';
  END IF;

  FOR evidence_item IN
    SELECT value FROM jsonb_array_elements(NEW.evidence_map_json)
  LOOP
    IF evidence_item->>'kind' = 'fact'
      AND jsonb_array_length(COALESCE(evidence_item->'evidenceIds', '[]'::jsonb)) = 0
    THEN
      RAISE EXCEPTION 'factual message spans require evidence';
    END IF;

    IF evidence_item->>'kind' <> 'fact'
      AND jsonb_array_length(COALESCE(evidence_item->'evidenceIds', '[]'::jsonb)) > 0
    THEN
      RAISE EXCEPTION 'only factual message spans may cite lead evidence';
    END IF;

    FOR cited_evidence_id IN
      SELECT value
      FROM jsonb_array_elements_text(COALESCE(evidence_item->'evidenceIds', '[]'::jsonb))
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM evidence e
        WHERE e.id = cited_evidence_id::uuid
          AND e.lead_id = NEW.lead_id
          AND e.state = 'active'
      ) THEN
        RAISE EXCEPTION 'message draft evidence must be active and belong to the lead';
      END IF;
    END LOOP;
  END LOOP;

  IF NEW.supersedes_id IS NULL AND (NEW.version <> 1 OR NEW.edit_source <> 'agent') THEN
    RAISE EXCEPTION 'initial message draft lineage is invalid';
  END IF;

  IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM message_drafts previous
    WHERE previous.id = NEW.supersedes_id
      AND previous.strategy_brief_id = NEW.strategy_brief_id
      AND previous.lead_id = NEW.lead_id
      AND previous.contact_id = NEW.contact_id
      AND previous.sequence_step = NEW.sequence_step
      AND previous.language = NEW.language
      AND NEW.version = previous.version + 1
      AND NEW.edit_source = 'human'
  ) THEN
    RAISE EXCEPTION 'message draft version lineage is invalid';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER message_draft_association_valid
BEFORE INSERT ON message_drafts
FOR EACH ROW
EXECUTE FUNCTION validate_message_draft();

CREATE OR REPLACE FUNCTION protect_message_draft()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'message drafts are immutable and append-only';
END;
$$;

CREATE TRIGGER message_drafts_append_only
BEFORE UPDATE OR DELETE ON message_drafts
FOR EACH ROW
EXECUTE FUNCTION protect_message_draft();

CREATE TABLE message_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_draft_id uuid NOT NULL REFERENCES message_drafts(id) ON DELETE RESTRICT,
  decision text NOT NULL,
  reason text,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_approval_decision_known CHECK (decision IN ('approved', 'rejected')),
  CONSTRAINT message_approval_rejection_reason CHECK (
    decision <> 'rejected' OR length(trim(reason)) > 0
  ),
  CONSTRAINT message_approval_one_decision_per_version UNIQUE (message_draft_id)
);

CREATE INDEX message_approvals_created_index
  ON message_approvals (created_at);

CREATE OR REPLACE FUNCTION validate_message_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM message_drafts newer
    WHERE newer.supersedes_id = NEW.message_draft_id
  ) THEN
    RAISE EXCEPTION 'only the latest message draft version can be decided';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM message_drafts draft
    WHERE draft.id = NEW.message_draft_id
      AND draft.qa_passed = true
      AND position('https://innovateats.com' in draft.body) > 0
  ) THEN
    RAISE EXCEPTION 'message approval requires a QA-passed draft with the required website';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER message_approval_valid
BEFORE INSERT ON message_approvals
FOR EACH ROW
EXECUTE FUNCTION validate_message_approval();

CREATE OR REPLACE FUNCTION protect_message_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'message approvals are append-only';
END;
$$;

CREATE TRIGGER message_approvals_append_only
BEFORE UPDATE OR DELETE ON message_approvals
FOR EACH ROW
EXECUTE FUNCTION protect_message_approval();
