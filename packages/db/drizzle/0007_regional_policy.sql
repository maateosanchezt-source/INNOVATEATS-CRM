ALTER TABLE contacts
  ADD COLUMN subscriber_type text NOT NULL DEFAULT 'unknown',
  ADD COLUMN consent_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN language_proficiency text NOT NULL DEFAULT 'unknown',
  ADD COLUMN compliance_evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN compliance_reviewed_by text,
  ADD COLUMN compliance_reviewed_at timestamptz,
  ADD CONSTRAINT contact_subscriber_type_known CHECK (
    subscriber_type IN ('corporate', 'sole_trader', 'partnership', 'individual', 'unknown')
  ),
  ADD CONSTRAINT contact_consent_status_known CHECK (
    consent_status IN ('express', 'inferred', 'prior_relationship', 'none', 'unknown')
  ),
  ADD CONSTRAINT contact_language_proficiency_known CHECK (
    language_proficiency IN ('native', 'high', 'unknown')
  ),
  ADD CONSTRAINT contact_compliance_review_shape CHECK (
    (compliance_reviewed_by IS NULL AND compliance_reviewed_at IS NULL)
    OR (compliance_reviewed_by IS NOT NULL AND compliance_reviewed_at IS NOT NULL)
  );

CREATE TABLE region_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id uuid NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
  version text NOT NULL,
  policy_json jsonb NOT NULL,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  source_urls_json jsonb NOT NULL,
  approved_by text,
  approved_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT region_policy_version_unique UNIQUE (region_id, version),
  CONSTRAINT region_policy_hash_shape CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT region_policy_status_known CHECK (status IN ('draft', 'active', 'retired')),
  CONSTRAINT region_policy_sources_array CHECK (jsonb_typeof(source_urls_json) = 'array'),
  CONSTRAINT region_policy_approval_shape CHECK (
    (status = 'draft' AND approved_by IS NULL AND approved_at IS NULL)
    OR (status IN ('active', 'retired') AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX region_policy_active_unique
  ON region_policy_versions (region_id)
  WHERE status = 'active';
CREATE INDEX region_policy_status_index
  ON region_policy_versions (status, created_at);

CREATE OR REPLACE FUNCTION protect_region_policy_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'region policy snapshots cannot be deleted physically';
  END IF;
  IF
    OLD.region_id IS DISTINCT FROM NEW.region_id
    OR OLD.version IS DISTINCT FROM NEW.version
    OR OLD.policy_json IS DISTINCT FROM NEW.policy_json
    OR OLD.content_hash IS DISTINCT FROM NEW.content_hash
    OR OLD.source_urls_json IS DISTINCT FROM NEW.source_urls_json
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NOT (
      (OLD.status = 'draft' AND NEW.status = 'active')
      OR (OLD.status = 'active' AND NEW.status = 'retired')
    )
  THEN
    RAISE EXCEPTION 'policy content is immutable and lifecycle is draft to active to retired';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER region_policy_version_protected
BEFORE UPDATE OR DELETE ON region_policy_versions
FOR EACH ROW
EXECUTE FUNCTION protect_region_policy_version();

CREATE TABLE compliance_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  region_policy_id uuid NOT NULL REFERENCES region_policy_versions(id) ON DELETE RESTRICT,
  region_policy_version text NOT NULL,
  channel text NOT NULL,
  decision text NOT NULL,
  reasons_json jsonb NOT NULL,
  legal_basis_tag text NOT NULL,
  input_hash text NOT NULL,
  input_json jsonb NOT NULL,
  output_json jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_channel_known CHECK (
    channel IN ('email', 'linkedin', 'instagram', 'kickstarter', 'indiegogo', 'upwork')
  ),
  CONSTRAINT compliance_decision_known CHECK (
    decision IN ('allow', 'approval_required', 'draft_only', 'block')
  ),
  CONSTRAINT compliance_input_hash_shape CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT compliance_reasons_array CHECK (
    jsonb_typeof(reasons_json) = 'array' AND jsonb_array_length(reasons_json) > 0
  )
);

CREATE INDEX compliance_decision_association_index
  ON compliance_decisions (lead_id, contact_id, campaign_id, created_at DESC);
CREATE INDEX compliance_decision_policy_index
  ON compliance_decisions (region_policy_id, created_at DESC);

CREATE OR REPLACE FUNCTION protect_compliance_decision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'compliance decisions are append-only';
END;
$$;

CREATE TRIGGER compliance_decision_append_only
BEFORE UPDATE OR DELETE ON compliance_decisions
FOR EACH ROW
EXECUTE FUNCTION protect_compliance_decision();

CREATE TABLE social_manual_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  compliance_decision_id uuid NOT NULL REFERENCES compliance_decisions(id) ON DELETE RESTRICT,
  channel text NOT NULL,
  direct_url text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  reminder_at timestamptz,
  copied_at timestamptz,
  marked_sent_at timestamptz,
  automatic_action_attempted boolean NOT NULL DEFAULT false,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_manual_channel_known CHECK (
    channel IN ('linkedin', 'instagram', 'kickstarter', 'indiegogo', 'upwork')
  ),
  CONSTRAINT social_manual_status_known CHECK (
    status IN ('draft', 'copied', 'marked_sent', 'cancelled')
  ),
  CONSTRAINT social_manual_direct_url_http CHECK (direct_url ~ '^https://'),
  CONSTRAINT social_manual_never_automated CHECK (automatic_action_attempted = false),
  CONSTRAINT social_manual_state_shape CHECK (
    (status = 'draft' AND copied_at IS NULL AND marked_sent_at IS NULL)
    OR (status = 'copied' AND copied_at IS NOT NULL AND marked_sent_at IS NULL)
    OR (status = 'marked_sent' AND copied_at IS NOT NULL AND marked_sent_at IS NOT NULL)
    OR (status = 'cancelled' AND marked_sent_at IS NULL)
  )
);

CREATE INDEX social_manual_lead_index
  ON social_manual_queue (lead_id, created_at DESC);
CREATE INDEX social_manual_reminder_index
  ON social_manual_queue (status, reminder_at);

CREATE OR REPLACE FUNCTION validate_social_manual_association()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM compliance_decisions decision
    WHERE decision.id = NEW.compliance_decision_id
      AND decision.lead_id = NEW.lead_id
      AND decision.contact_id = NEW.contact_id
      AND decision.channel = NEW.channel
      AND decision.decision = 'draft_only'
  ) THEN
    RAISE EXCEPTION 'social queue requires a matching manual-only compliance decision';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_manual_association_valid
BEFORE INSERT ON social_manual_queue
FOR EACH ROW
EXECUTE FUNCTION validate_social_manual_association();

CREATE OR REPLACE FUNCTION protect_social_manual_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'social queue records cannot be deleted physically';
  END IF;
  IF
    OLD.lead_id IS DISTINCT FROM NEW.lead_id
    OR OLD.contact_id IS DISTINCT FROM NEW.contact_id
    OR OLD.compliance_decision_id IS DISTINCT FROM NEW.compliance_decision_id
    OR OLD.channel IS DISTINCT FROM NEW.channel
    OR OLD.direct_url IS DISTINCT FROM NEW.direct_url
    OR OLD.message IS DISTINCT FROM NEW.message
    OR OLD.automatic_action_attempted IS DISTINCT FROM NEW.automatic_action_attempted
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NOT (
      (OLD.status = 'draft' AND NEW.status IN ('copied', 'cancelled'))
      OR (OLD.status = 'copied' AND NEW.status IN ('marked_sent', 'cancelled'))
    )
  THEN
    RAISE EXCEPTION 'social queue content is immutable and state transitions are one-way';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_manual_item_protected
BEFORE UPDATE OR DELETE ON social_manual_queue
FOR EACH ROW
EXECUTE FUNCTION protect_social_manual_item();

ALTER TABLE sequences
  ADD COLUMN compliance_decision_id uuid REFERENCES compliance_decisions(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION validate_sequence_compliance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.delivery_mode <> 'dry_run' AND NEW.compliance_decision_id IS NULL THEN
    RAISE EXCEPTION 'external sequences require a compliance decision';
  END IF;
  IF NEW.compliance_decision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM compliance_decisions decision
    JOIN region_policy_versions policy ON policy.id = decision.region_policy_id
    JOIN regions region ON region.id = policy.region_id
    WHERE decision.id = NEW.compliance_decision_id
      AND decision.lead_id = NEW.lead_id
      AND decision.contact_id = NEW.contact_id
      AND decision.campaign_id = NEW.campaign_id
      AND decision.channel = 'email'
      AND (
        NEW.delivery_mode = 'dry_run'
        OR (
          decision.decision IN ('allow', 'approval_required')
          AND policy.status = 'active'
          AND region.enabled = true
          AND decision.region_policy_version = policy.version
        )
      )
  ) THEN
    RAISE EXCEPTION 'sequence compliance decision is missing, stale, blocked, or mismatched';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sequence_compliance_valid
BEFORE INSERT ON sequences
FOR EACH ROW
EXECUTE FUNCTION validate_sequence_compliance();
