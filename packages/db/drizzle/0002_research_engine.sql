ALTER TABLE sources DROP CONSTRAINT source_type_known;
ALTER TABLE sources
  ADD CONSTRAINT source_type_known
  CHECK (type IN ('manual_url', 'seed', 'web_search', 'secure_fetch'));

DROP INDEX source_documents_canonical_url_unique;
CREATE UNIQUE INDEX source_documents_manual_canonical_unique
  ON source_documents (canonical_url)
  WHERE content_hash IS NULL;
CREATE UNIQUE INDEX source_documents_snapshot_unique
  ON source_documents (canonical_url, content_hash)
  WHERE content_hash IS NOT NULL;

CREATE TABLE founders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name text NOT NULL,
  normalized_name text NOT NULL,
  role text NOT NULL,
  public_profile_urls_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence real NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT founder_confidence_range CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT founder_profiles_array CHECK (jsonb_typeof(public_profile_urls_json) = 'array')
);

CREATE UNIQUE INDEX founders_organization_name_unique
  ON founders (organization_id, normalized_name);
CREATE INDEX founders_organization_index ON founders (organization_id);

CREATE TABLE lead_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  rubric_version text NOT NULL,
  breakdown_json jsonb NOT NULL,
  explanations_json jsonb NOT NULL,
  total integer NOT NULL,
  confidence real NOT NULL,
  evidence_ids_json jsonb NOT NULL,
  missing_information_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  hard_exclusion boolean NOT NULL DEFAULT false,
  exclusion_reason text,
  recommended_action text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_score_total_range CHECK (total BETWEEN 0 AND 100),
  CONSTRAINT lead_score_confidence_range CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT lead_score_breakdown_object CHECK (jsonb_typeof(breakdown_json) = 'object'),
  CONSTRAINT lead_score_explanations_object CHECK (jsonb_typeof(explanations_json) = 'object'),
  CONSTRAINT lead_score_evidence_array CHECK (jsonb_typeof(evidence_ids_json) = 'array'),
  CONSTRAINT lead_score_missing_information_array CHECK (
    jsonb_typeof(missing_information_json) = 'array'
  ),
  CONSTRAINT lead_score_exclusion_consistent CHECK (
    (hard_exclusion AND exclusion_reason IS NOT NULL)
    OR
    (NOT hard_exclusion AND exclusion_reason IS NULL)
  ),
  CONSTRAINT lead_score_action_known CHECK (
    recommended_action IN (
      'advance',
      'approval_required',
      'nurture',
      'archive',
      'reject_hard_exclusion',
      'manual_research'
    )
  )
);

CREATE INDEX lead_scores_lead_created_index ON lead_scores (lead_id, created_at);
CREATE INDEX lead_scores_total_index ON lead_scores (total);

CREATE OR REPLACE FUNCTION protect_lead_score()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'lead scores are append-only';
END;
$$;

CREATE TRIGGER lead_scores_append_only
BEFORE UPDATE OR DELETE ON lead_scores
FOR EACH ROW
EXECUTE FUNCTION protect_lead_score();

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name text NOT NULL,
  prompt_version text NOT NULL,
  model text NOT NULL,
  input_hash text NOT NULL,
  output_json jsonb,
  trace_id text,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT agent_run_input_hash_format CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT agent_run_tokens_nonnegative CHECK (tokens_in >= 0 AND tokens_out >= 0),
  CONSTRAINT agent_run_cost_nonnegative CHECK (cost_usd >= 0),
  CONSTRAINT agent_run_status_known CHECK (
    status IN ('running', 'succeeded', 'failed', 'blocked')
  ),
  CONSTRAINT agent_run_completion_consistent CHECK (
    (status = 'running' AND completed_at IS NULL)
    OR
    (status <> 'running' AND completed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX agent_runs_idempotency_unique
  ON agent_runs (agent_name, prompt_version, input_hash);
CREATE INDEX agent_runs_status_index ON agent_runs (status);
CREATE INDEX agent_runs_created_index ON agent_runs (created_at);
