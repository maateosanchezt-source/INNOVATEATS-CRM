CREATE TABLE prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name text NOT NULL,
  version text NOT NULL,
  content_hash text NOT NULL,
  configuration_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  approved_by text,
  approved_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_version_unique UNIQUE (agent_name, version),
  CONSTRAINT prompt_version_hash_shape CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT prompt_version_status_known CHECK (status IN ('draft', 'active', 'retired')),
  CONSTRAINT prompt_version_approval_shape CHECK (
    (status = 'draft' AND approved_by IS NULL AND approved_at IS NULL)
    OR (status IN ('active', 'retired') AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX prompt_active_agent_unique
  ON prompt_versions (agent_name)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION protect_prompt_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'prompt versions cannot be deleted physically';
  END IF;
  IF
    OLD.agent_name IS DISTINCT FROM NEW.agent_name
    OR OLD.version IS DISTINCT FROM NEW.version
    OR OLD.content_hash IS DISTINCT FROM NEW.content_hash
    OR OLD.configuration_json IS DISTINCT FROM NEW.configuration_json
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NOT (
      (OLD.status = 'draft' AND NEW.status = 'active')
      OR (OLD.status = 'active' AND NEW.status = 'retired')
    )
  THEN
    RAISE EXCEPTION 'prompt content is immutable and lifecycle is draft to active to retired';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prompt_version_protected
BEFORE UPDATE OR DELETE ON prompt_versions
FOR EACH ROW
EXECUTE FUNCTION protect_prompt_version();

CREATE TABLE eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_version text NOT NULL,
  dataset_version text NOT NULL,
  commit_sha text,
  status text NOT NULL DEFAULT 'running',
  report_json jsonb,
  automated_passed boolean,
  pilot_ready boolean,
  started_by text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT eval_run_status_known CHECK (status IN ('running', 'passed', 'failed')),
  CONSTRAINT eval_run_completion_shape CHECK (
    (status = 'running' AND report_json IS NULL AND automated_passed IS NULL
      AND pilot_ready IS NULL AND completed_at IS NULL)
    OR (status IN ('passed', 'failed') AND report_json IS NOT NULL
      AND automated_passed IS NOT NULL AND pilot_ready IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX eval_runs_status_started_index ON eval_runs (status, started_at DESC);

CREATE OR REPLACE FUNCTION protect_eval_run()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'eval runs cannot be deleted physically';
  END IF;
  IF
    OLD.suite_version IS DISTINCT FROM NEW.suite_version
    OR OLD.dataset_version IS DISTINCT FROM NEW.dataset_version
    OR OLD.commit_sha IS DISTINCT FROM NEW.commit_sha
    OR OLD.started_by IS DISTINCT FROM NEW.started_by
    OR OLD.started_at IS DISTINCT FROM NEW.started_at
    OR OLD.status <> 'running'
    OR NEW.status NOT IN ('passed', 'failed')
  THEN
    RAISE EXCEPTION 'eval run identity is immutable and completion is one-way';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER eval_run_protected
BEFORE UPDATE OR DELETE ON eval_runs
FOR EACH ROW
EXECUTE FUNCTION protect_eval_run();

CREATE TABLE pilot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  mode text NOT NULL DEFAULT 'simulation',
  status text NOT NULL DEFAULT 'planned',
  target_leads integer NOT NULL DEFAULT 50,
  allowed_regions_json jsonb NOT NULL,
  daily_email_cap integer NOT NULL DEFAULT 10,
  review_interval integer NOT NULL DEFAULT 20,
  human_approval_required boolean NOT NULL DEFAULT true,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  external_authorized boolean NOT NULL DEFAULT false,
  authorized_by text,
  authorized_at timestamptz,
  signed_results_by text,
  signed_results_at timestamptz,
  result_json jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pilot_mode_known CHECK (mode IN ('simulation', 'sandbox', 'production')),
  CONSTRAINT pilot_status_known CHECK (status IN ('planned', 'running', 'completed', 'aborted')),
  CONSTRAINT pilot_target_exact CHECK (target_leads = 50),
  CONSTRAINT pilot_daily_cap_safe CHECK (daily_email_cap BETWEEN 1 AND 10),
  CONSTRAINT pilot_review_interval_exact CHECK (review_interval = 20),
  CONSTRAINT pilot_human_approval_required CHECK (human_approval_required = true),
  CONSTRAINT pilot_regions_array CHECK (
    jsonb_typeof(allowed_regions_json) = 'array'
    AND jsonb_array_length(allowed_regions_json) = 2
    AND allowed_regions_json <@ '["US","UK"]'::jsonb
    AND allowed_regions_json @> '["US","UK"]'::jsonb
  ),
  CONSTRAINT pilot_window_valid CHECK (
    ends_at = starts_at + interval '14 days'
  ),
  CONSTRAINT pilot_external_authority_shape CHECK (
    (external_authorized = false AND authorized_by IS NULL AND authorized_at IS NULL)
    OR (external_authorized = true AND authorized_by IS NOT NULL AND authorized_at IS NOT NULL)
  ),
  CONSTRAINT pilot_production_authorized CHECK (
    mode <> 'production' OR external_authorized = true
  ),
  CONSTRAINT pilot_signature_shape CHECK (
    (signed_results_by IS NULL AND signed_results_at IS NULL)
    OR (signed_results_by IS NOT NULL AND signed_results_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX pilot_one_running_unique
  ON pilot_runs ((status))
  WHERE status = 'running';
CREATE INDEX pilot_runs_status_window_index ON pilot_runs (status, starts_at, ends_at);

CREATE OR REPLACE FUNCTION protect_pilot_run()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'pilot runs cannot be deleted physically';
  END IF;
  IF
    OLD.name IS DISTINCT FROM NEW.name
    OR OLD.mode IS DISTINCT FROM NEW.mode
    OR OLD.target_leads IS DISTINCT FROM NEW.target_leads
    OR OLD.allowed_regions_json IS DISTINCT FROM NEW.allowed_regions_json
    OR OLD.daily_email_cap IS DISTINCT FROM NEW.daily_email_cap
    OR OLD.review_interval IS DISTINCT FROM NEW.review_interval
    OR OLD.human_approval_required IS DISTINCT FROM NEW.human_approval_required
    OR OLD.starts_at IS DISTINCT FROM NEW.starts_at
    OR OLD.ends_at IS DISTINCT FROM NEW.ends_at
    OR OLD.external_authorized IS DISTINCT FROM NEW.external_authorized
    OR OLD.authorized_by IS DISTINCT FROM NEW.authorized_by
    OR OLD.authorized_at IS DISTINCT FROM NEW.authorized_at
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NOT (
      (OLD.status = 'planned' AND NEW.status IN ('running', 'aborted'))
      OR (OLD.status = 'running' AND NEW.status IN ('completed', 'aborted'))
    )
  THEN
    RAISE EXCEPTION 'pilot configuration is immutable and lifecycle is one-way';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pilot_run_protected
BEFORE UPDATE OR DELETE ON pilot_runs
FOR EACH ROW
EXECUTE FUNCTION protect_pilot_run();

CREATE TABLE pilot_review_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_run_id uuid NOT NULL REFERENCES pilot_runs(id) ON DELETE RESTRICT,
  after_message_count integer NOT NULL,
  metrics_json jsonb NOT NULL,
  decision text NOT NULL,
  notes text NOT NULL,
  reviewed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pilot_checkpoint_message_unique UNIQUE (pilot_run_id, after_message_count),
  CONSTRAINT pilot_checkpoint_interval CHECK (
    after_message_count > 0 AND after_message_count % 20 = 0
  ),
  CONSTRAINT pilot_checkpoint_decision_known CHECK (
    decision IN ('continue', 'pause', 'abort')
  )
);

CREATE OR REPLACE FUNCTION prevent_pilot_checkpoint_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'pilot review checkpoints are append-only';
END;
$$;

CREATE TRIGGER pilot_checkpoint_append_only
BEFORE UPDATE OR DELETE ON pilot_review_checkpoints
FOR EACH ROW
EXECUTE FUNCTION prevent_pilot_checkpoint_mutation();

CREATE TABLE go_live_checklist_items (
  key text PRIMARY KEY,
  category text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'unknown',
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT go_live_checklist_status_known CHECK (status IN ('unknown', 'passed', 'blocked')),
  CONSTRAINT go_live_checklist_review_shape CHECK (
    (status = 'unknown' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (
      status IN ('passed', 'blocked')
      AND reviewed_by IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND evidence_json <> '{}'::jsonb
    )
  )
);

CREATE OR REPLACE FUNCTION protect_go_live_checklist_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'go-live checklist items cannot be deleted physically';
  END IF;
  IF
    OLD.key IS DISTINCT FROM NEW.key
    OR OLD.category IS DISTINCT FROM NEW.category
    OR OLD.label IS DISTINCT FROM NEW.label
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'go-live checklist identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER go_live_checklist_identity_protected
BEFORE UPDATE OR DELETE ON go_live_checklist_items
FOR EACH ROW
EXECUTE FUNCTION protect_go_live_checklist_identity();

CREATE TABLE message_quality_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_draft_id uuid NOT NULL REFERENCES message_drafts(id) ON DELETE RESTRICT,
  research_accuracy integer NOT NULL,
  opportunity_insight integer NOT NULL,
  innovateats_fit integer NOT NULL,
  mateo_credibility integer NOT NULL,
  naturalness integer NOT NULL,
  cta_quality integer NOT NULL,
  risk_safety integer NOT NULL,
  average_score numeric(4,2) NOT NULL,
  notes text NOT NULL,
  reviewed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_quality_review_draft_unique UNIQUE (message_draft_id),
  CONSTRAINT message_quality_scores_range CHECK (
    research_accuracy BETWEEN 1 AND 5
    AND opportunity_insight BETWEEN 1 AND 5
    AND innovateats_fit BETWEEN 1 AND 5
    AND mateo_credibility BETWEEN 1 AND 5
    AND naturalness BETWEEN 1 AND 5
    AND cta_quality BETWEEN 1 AND 5
    AND risk_safety BETWEEN 1 AND 5
  ),
  CONSTRAINT message_quality_average_exact CHECK (
    average_score = round((
      research_accuracy + opportunity_insight + innovateats_fit + mateo_credibility
      + naturalness + cta_quality + risk_safety
    )::numeric / 7, 2)
  )
);

CREATE INDEX message_quality_review_created_index
  ON message_quality_reviews (created_at DESC);

CREATE OR REPLACE FUNCTION prevent_message_quality_review_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'message quality reviews are append-only';
END;
$$;

CREATE TRIGGER message_quality_review_append_only
BEFORE UPDATE OR DELETE ON message_quality_reviews
FOR EACH ROW
EXECUTE FUNCTION prevent_message_quality_review_mutation();

INSERT INTO go_live_checklist_items (key, category, label)
VALUES
  ('spf', 'deliverability', 'SPF record verified for the sending domain'),
  ('dkim', 'deliverability', 'DKIM signing verified for the sending mailbox'),
  ('dmarc', 'deliverability', 'DMARC policy and reporting verified'),
  ('sender_profile', 'identity', 'Mateo / InnovatEats sender profile is complete'),
  ('postal_address', 'identity', 'Valid physical postal address is configured'),
  ('privacy_notice', 'privacy', 'Privacy notice covers outreach processing'),
  ('suppression', 'safety', 'Suppression workflow and export are verified'),
  ('backups', 'operations', 'Database backup and restore evidence exists'),
  ('monitoring', 'operations', 'Monitoring and alert routing are verified'),
  ('incident_channel', 'operations', 'Incident owner and channel are documented'),
  ('kill_switch', 'safety', 'Global kill-switch drill passed'),
  ('budget_caps', 'safety', 'Token and email hard caps are verified'),
  ('legal_review', 'compliance', 'Regional outreach policy received legal review'),
  ('signed_pilot', 'pilot', 'Fifty-lead pilot results are signed by Mateo');
