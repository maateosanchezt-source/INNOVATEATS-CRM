CREATE TABLE sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  name text NOT NULL,
  base_url text,
  terms_status text NOT NULL DEFAULT 'manual_review',
  robots_status text NOT NULL DEFAULT 'not_checked',
  enabled boolean NOT NULL DEFAULT true,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_type_known CHECK (type IN ('manual_url', 'seed', 'web_search')),
  CONSTRAINT source_terms_status_known CHECK (
    terms_status IN ('allowed', 'manual_review', 'blocked')
  ),
  CONSTRAINT source_robots_status_known CHECK (
    robots_status IN ('allowed', 'not_checked', 'blocked')
  )
);

CREATE UNIQUE INDEX sources_type_name_unique ON sources (type, name);

CREATE TABLE source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  url text NOT NULL,
  canonical_url text NOT NULL,
  fetched_at timestamptz,
  content_hash text,
  title text,
  extracted_text text,
  object_storage_key text,
  trust_level text NOT NULL DEFAULT 'user_provided',
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_document_trust_known CHECK (
    trust_level IN ('user_provided', 'primary', 'secondary', 'unverified')
  )
);

CREATE UNIQUE INDEX source_documents_canonical_url_unique
  ON source_documents (canonical_url);
CREATE INDEX source_documents_source_index ON source_documents (source_id);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_name text NOT NULL,
  display_name text NOT NULL,
  canonical_domain text NOT NULL,
  country text NOT NULL DEFAULT 'Unknown',
  region_id uuid REFERENCES regions(id) ON DELETE SET NULL,
  stage text NOT NULL DEFAULT 'unknown',
  product_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_stage_known CHECK (
    stage IN (
      'idea',
      'prelaunch',
      'crowdfunding',
      'first_production',
      'first_sales',
      'early_growth',
      'mature',
      'unknown'
    )
  )
);

CREATE UNIQUE INDEX organizations_domain_unique ON organizations (canonical_domain);
CREATE INDEX organizations_normalized_name_index ON organizations (normalized_name);
CREATE INDEX organizations_region_index ON organizations (region_id);

CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'discovered',
  icp_score integer NOT NULL DEFAULT 0,
  score_confidence real NOT NULL DEFAULT 0,
  hard_exclusion boolean NOT NULL DEFAULT false,
  exclusion_reason text,
  discovery_signal text,
  current_owner text,
  next_action_at timestamptz,
  first_discovered_at timestamptz NOT NULL DEFAULT now(),
  last_researched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_icp_score_range CHECK (icp_score BETWEEN 0 AND 100),
  CONSTRAINT lead_score_confidence_range CHECK (score_confidence BETWEEN 0 AND 1),
  CONSTRAINT lead_status_known CHECK (
    status IN (
      'discovered',
      'entity_resolved',
      'researched',
      'scored',
      'contact_found',
      'message_drafted',
      'qa_passed',
      'approval_pending',
      'scheduled',
      'contacted',
      'follow_up_wait',
      'responded',
      'handoff_ready',
      'mateo_owned',
      'rejected_icp',
      'no_contact',
      'blocked_policy',
      'suppressed',
      'no_response_nurture',
      'not_interested',
      'invalid',
      'duplicate'
    )
  ),
  CONSTRAINT lead_exclusion_reason_present CHECK (
    NOT hard_exclusion OR exclusion_reason IS NOT NULL
  )
);

CREATE UNIQUE INDEX leads_organization_unique ON leads (organization_id);
CREATE INDEX leads_status_index ON leads (status);
CREATE INDEX leads_score_index ON leads (icp_score);
CREATE INDEX leads_next_action_index ON leads (next_action_at);

CREATE TABLE evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  source_document_id uuid REFERENCES source_documents(id) ON DELETE RESTRICT,
  fact_type text NOT NULL,
  claim text NOT NULL,
  quote_or_summary text NOT NULL,
  source_url text NOT NULL,
  observed_at timestamptz NOT NULL,
  confidence real NOT NULL,
  is_inference boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  supersedes_id uuid REFERENCES evidence(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'active',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  CONSTRAINT evidence_confidence_range CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT evidence_version_positive CHECK (version >= 1),
  CONSTRAINT evidence_state_known CHECK (state IN ('active', 'superseded', 'deleted')),
  CONSTRAINT evidence_state_consistent CHECK (
    (state = 'active' AND superseded_at IS NULL)
    OR
    (state IN ('superseded', 'deleted') AND superseded_at IS NOT NULL)
  )
);

CREATE INDEX evidence_lead_state_index ON evidence (lead_id, state);
CREATE INDEX evidence_source_document_index ON evidence (source_document_id);
CREATE UNIQUE INDEX evidence_supersedes_unique
  ON evidence (supersedes_id)
  WHERE supersedes_id IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_evidence_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'evidence is versioned and cannot be deleted physically';
  END IF;

  IF
    OLD.lead_id IS DISTINCT FROM NEW.lead_id
    OR OLD.source_document_id IS DISTINCT FROM NEW.source_document_id
    OR OLD.fact_type IS DISTINCT FROM NEW.fact_type
    OR OLD.claim IS DISTINCT FROM NEW.claim
    OR OLD.quote_or_summary IS DISTINCT FROM NEW.quote_or_summary
    OR OLD.source_url IS DISTINCT FROM NEW.source_url
    OR OLD.observed_at IS DISTINCT FROM NEW.observed_at
    OR OLD.confidence IS DISTINCT FROM NEW.confidence
    OR OLD.is_inference IS DISTINCT FROM NEW.is_inference
    OR OLD.version IS DISTINCT FROM NEW.version
    OR OLD.supersedes_id IS DISTINCT FROM NEW.supersedes_id
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'evidence content is immutable; create a new version';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_content_immutable
BEFORE UPDATE OR DELETE ON evidence
FOR EACH ROW
EXECUTE FUNCTION protect_evidence_content();

CREATE TABLE lead_status_history (
  id bigserial PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL,
  reason text,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lead_status_history_lead_index
  ON lead_status_history (lead_id, created_at);
