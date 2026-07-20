CREATE TABLE discovery_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  region_id uuid NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',
  target_candidates integer NOT NULL DEFAULT 500,
  daily_candidate_cap integer NOT NULL DEFAULT 100,
  results_per_seed integer NOT NULL DEFAULT 25,
  min_followers integer NOT NULL DEFAULT 50,
  max_followers integer NOT NULL DEFAULT 50000,
  active_within_days integer NOT NULL DEFAULT 90,
  schedule_interval_hours integer NOT NULL DEFAULT 24,
  auto_schedule boolean NOT NULL DEFAULT false,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discovery_campaign_name_unique UNIQUE (name),
  CONSTRAINT discovery_campaign_status_known CHECK (status IN ('active', 'paused', 'completed')),
  CONSTRAINT discovery_campaign_target_range CHECK (target_candidates BETWEEN 1 AND 5000),
  CONSTRAINT discovery_campaign_daily_cap_range CHECK (daily_candidate_cap BETWEEN 10 AND 500),
  CONSTRAINT discovery_campaign_seed_limit_range CHECK (results_per_seed BETWEEN 5 AND 250),
  CONSTRAINT discovery_campaign_follower_range CHECK (
    min_followers >= 0 AND max_followers >= min_followers AND max_followers <= 10000000
  ),
  CONSTRAINT discovery_campaign_activity_range CHECK (active_within_days BETWEEN 1 AND 365),
  CONSTRAINT discovery_campaign_interval_range CHECK (schedule_interval_hours BETWEEN 1 AND 168),
  CONSTRAINT discovery_campaign_schedule_shape CHECK (
    (auto_schedule = false)
    OR (auto_schedule = true AND next_run_at IS NOT NULL)
  )
);

CREATE INDEX discovery_campaign_due_index
  ON discovery_campaigns (status, auto_schedule, next_run_at);
CREATE INDEX discovery_campaign_region_index ON discovery_campaigns (region_id);

CREATE TABLE discovery_seeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES discovery_campaigns(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  value text NOT NULL,
  normalized_value text NOT NULL,
  track text NOT NULL,
  priority integer NOT NULL DEFAULT 50,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discovery_seed_kind_known CHECK (
    kind IN ('keyword', 'hashtag', 'profile_followers', 'profile_following')
  ),
  CONSTRAINT discovery_seed_track_known CHECK (track IN ('food_brand', 'dropshipping_founder')),
  CONSTRAINT discovery_seed_priority_range CHECK (priority BETWEEN 1 AND 100),
  CONSTRAINT discovery_seed_campaign_unique UNIQUE (
    campaign_id, kind, track, normalized_value
  )
);

CREATE INDEX discovery_seed_campaign_active_index
  ON discovery_seeds (campaign_id, active, priority DESC);

CREATE TABLE discovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES discovery_campaigns(id) ON DELETE RESTRICT,
  workflow_id text NOT NULL,
  idempotency_key text NOT NULL,
  trigger text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  discovered_count integer NOT NULL DEFAULT 0,
  enriched_count integer NOT NULL DEFAULT 0,
  accepted_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  queued_by text NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discovery_run_workflow_unique UNIQUE (workflow_id),
  CONSTRAINT discovery_run_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT discovery_run_trigger_known CHECK (trigger IN ('manual', 'schedule')),
  CONSTRAINT discovery_run_status_known CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  CONSTRAINT discovery_run_counts_nonnegative CHECK (
    discovered_count >= 0 AND enriched_count >= 0
    AND accepted_count >= 0 AND rejected_count >= 0
    AND estimated_cost_usd >= 0
  ),
  CONSTRAINT discovery_run_lifecycle_shape CHECK (
    (status = 'queued' AND started_at IS NULL AND completed_at IS NULL AND error_code IS NULL)
    OR (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL AND error_code IS NULL)
    OR (
      status = 'succeeded' AND started_at IS NOT NULL AND completed_at IS NOT NULL
      AND error_code IS NULL AND error_message IS NULL
    )
    OR (
      status IN ('failed', 'cancelled') AND completed_at IS NOT NULL
      AND error_code IS NOT NULL AND error_message IS NOT NULL
    )
  )
);

CREATE INDEX discovery_run_status_queue_index ON discovery_runs (status, queued_at);
CREATE INDEX discovery_run_campaign_index ON discovery_runs (campaign_id, queued_at DESC);

CREATE TABLE discovery_provider_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES discovery_runs(id) ON DELETE RESTRICT,
  seed_id uuid REFERENCES discovery_seeds(id) ON DELETE RESTRICT,
  action_key text NOT NULL,
  provider text NOT NULL,
  actor_id text NOT NULL,
  input_hash text NOT NULL,
  status text NOT NULL DEFAULT 'claimed',
  provider_run_id text,
  dataset_id text,
  item_count integer NOT NULL DEFAULT 0,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT discovery_provider_action_key_unique UNIQUE (action_key),
  CONSTRAINT discovery_provider_input_hash_shape CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT discovery_provider_status_known CHECK (
    status IN ('claimed', 'running', 'succeeded', 'failed', 'unknown')
  ),
  CONSTRAINT discovery_provider_item_count_nonnegative CHECK (item_count >= 0),
  CONSTRAINT discovery_provider_lifecycle_shape CHECK (
    (
      status = 'claimed' AND provider_run_id IS NULL AND dataset_id IS NULL
      AND started_at IS NULL AND completed_at IS NULL
    )
    OR (
      status = 'running' AND provider_run_id IS NOT NULL AND dataset_id IS NOT NULL
      AND started_at IS NOT NULL AND completed_at IS NULL
    )
    OR (
      status = 'succeeded' AND provider_run_id IS NOT NULL AND dataset_id IS NOT NULL
      AND started_at IS NOT NULL AND completed_at IS NOT NULL AND error_code IS NULL
    )
    OR (
      status = 'failed' AND provider_run_id IS NOT NULL
      AND started_at IS NOT NULL AND completed_at IS NOT NULL AND error_code IS NOT NULL
    )
    OR (
      status = 'unknown' AND completed_at IS NOT NULL AND error_code IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX discovery_provider_run_unique
  ON discovery_provider_actions (provider, provider_run_id)
  WHERE provider_run_id IS NOT NULL;
CREATE INDEX discovery_provider_action_run_index
  ON discovery_provider_actions (run_id, status);

CREATE TABLE discovery_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES discovery_campaigns(id) ON DELETE RESTRICT,
  first_run_id uuid NOT NULL REFERENCES discovery_runs(id) ON DELETE RESTRICT,
  username text NOT NULL,
  profile_url text NOT NULL,
  full_name text,
  biography text,
  external_url text,
  followers_count integer,
  follows_count integer,
  posts_count integer,
  is_business_account boolean,
  is_private boolean NOT NULL DEFAULT false,
  is_verified boolean NOT NULL DEFAULT false,
  business_category text,
  track text NOT NULL,
  country text NOT NULL DEFAULT 'Spain',
  latest_post_at timestamptz,
  snapshot_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'needs_review',
  filter_reasons_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_reason text,
  decided_by text,
  decided_at timestamptz,
  lead_id uuid REFERENCES leads(id) ON DELETE RESTRICT,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discovery_candidate_campaign_username_unique UNIQUE (campaign_id, username),
  CONSTRAINT discovery_candidate_username_shape CHECK (username ~ '^[a-z0-9._]{1,30}$'),
  CONSTRAINT discovery_candidate_track_known CHECK (
    track IN ('food_brand', 'dropshipping_founder')
  ),
  CONSTRAINT discovery_candidate_status_known CHECK (
    status IN ('needs_review', 'approved', 'rejected', 'imported', 'duplicate')
  ),
  CONSTRAINT discovery_candidate_counts_nonnegative CHECK (
    (followers_count IS NULL OR followers_count >= 0)
    AND (follows_count IS NULL OR follows_count >= 0)
    AND (posts_count IS NULL OR posts_count >= 0)
  ),
  CONSTRAINT discovery_candidate_filter_array CHECK (
    jsonb_typeof(filter_reasons_json) = 'array'
  ),
  CONSTRAINT discovery_candidate_decision_shape CHECK (
    (
      status = 'needs_review' AND decision_reason IS NULL
      AND decided_by IS NULL AND decided_at IS NULL AND lead_id IS NULL
    )
    OR (
      status IN ('approved', 'rejected') AND decision_reason IS NOT NULL
      AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND lead_id IS NULL
    )
    OR (
      status = 'imported' AND decision_reason IS NOT NULL
      AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND lead_id IS NOT NULL
    )
    OR (
      status = 'duplicate' AND decision_reason IS NOT NULL
      AND decided_by IS NOT NULL AND decided_at IS NOT NULL
    )
  )
);

CREATE INDEX discovery_candidate_status_index
  ON discovery_candidates (campaign_id, status, last_seen_at DESC);
CREATE INDEX discovery_candidate_track_index ON discovery_candidates (track, status);
CREATE INDEX discovery_candidate_lead_index ON discovery_candidates (lead_id);

CREATE TABLE discovery_candidate_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES discovery_candidates(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES discovery_runs(id) ON DELETE RESTRICT,
  seed_id uuid NOT NULL REFERENCES discovery_seeds(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  provider_result_id text NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discovery_candidate_source_unique UNIQUE (candidate_id, run_id, seed_id)
);

CREATE INDEX discovery_candidate_source_candidate_index
  ON discovery_candidate_sources (candidate_id, discovered_at DESC);

CREATE OR REPLACE FUNCTION protect_discovery_candidate_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'discovery candidate sources are append-only';
END;
$$;

CREATE TRIGGER discovery_candidate_source_append_only
BEFORE UPDATE OR DELETE ON discovery_candidate_sources
FOR EACH ROW
EXECUTE FUNCTION protect_discovery_candidate_source();

CREATE OR REPLACE FUNCTION protect_discovery_candidate_decision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'discovery candidates cannot be deleted physically';
  END IF;
  IF
    OLD.campaign_id IS DISTINCT FROM NEW.campaign_id
    OR OLD.first_run_id IS DISTINCT FROM NEW.first_run_id
    OR OLD.username IS DISTINCT FROM NEW.username
    OR OLD.first_seen_at IS DISTINCT FROM NEW.first_seen_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'discovery candidate identity is immutable';
  END IF;
  IF OLD.status <> 'needs_review' AND (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.decision_reason IS DISTINCT FROM NEW.decision_reason
    OR OLD.decided_by IS DISTINCT FROM NEW.decided_by
    OR OLD.decided_at IS DISTINCT FROM NEW.decided_at
  ) THEN
    IF NOT (OLD.status = 'approved' AND NEW.status = 'imported') THEN
      RAISE EXCEPTION 'discovery candidate decision is one-way';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER discovery_candidate_decision_protected
BEFORE UPDATE OR DELETE ON discovery_candidates
FOR EACH ROW
EXECUTE FUNCTION protect_discovery_candidate_decision();

CREATE OR REPLACE FUNCTION protect_discovery_provider_action()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'discovery provider actions cannot be deleted physically';
  END IF;
  IF
    OLD.run_id IS DISTINCT FROM NEW.run_id
    OR OLD.seed_id IS DISTINCT FROM NEW.seed_id
    OR OLD.action_key IS DISTINCT FROM NEW.action_key
    OR OLD.provider IS DISTINCT FROM NEW.provider
    OR OLD.actor_id IS DISTINCT FROM NEW.actor_id
    OR OLD.input_hash IS DISTINCT FROM NEW.input_hash
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'discovery provider action identity is immutable';
  END IF;
  IF OLD.status IN ('succeeded', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'discovery provider action completion is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER discovery_provider_action_protected
BEFORE UPDATE OR DELETE ON discovery_provider_actions
FOR EACH ROW
EXECUTE FUNCTION protect_discovery_provider_action();
