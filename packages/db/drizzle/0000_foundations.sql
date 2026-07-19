CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_email_unique ON "user" (lower(email));

CREATE TABLE IF NOT EXISTS "session" (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS session_token_unique ON "session" (token);
CREATE INDEX IF NOT EXISTS session_user_id_index ON "session" (user_id);

CREATE TABLE IF NOT EXISTS account (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS account_provider_identity_unique
  ON account (provider_id, account_id);
CREATE INDEX IF NOT EXISTS account_user_id_index ON account (user_id);

CREATE TABLE IF NOT EXISTS verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verification_identifier_index ON verification (identifier);

CREATE TABLE IF NOT EXISTS feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  description text NOT NULL,
  risk_tier text NOT NULL DEFAULT 'high',
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_flag_known_key CHECK (
    key IN (
      'global_dry_run',
      'research_enabled',
      'contact_enrichment_enabled',
      'message_generation_enabled',
      'email_send_enabled',
      'autonomous_send_enabled',
      'inbound_processing_enabled',
      'social_manual_queue_enabled'
    )
  ),
  CONSTRAINT feature_flag_risk_tier CHECK (risk_tier IN ('low', 'medium', 'high', 'critical'))
);

CREATE TABLE IF NOT EXISTS kill_switches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL,
  scope_id text,
  active boolean NOT NULL DEFAULT true,
  reason text NOT NULL,
  activated_by text NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now(),
  released_by text,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kill_switch_scope_type CHECK (
    scope_type IN ('global', 'region', 'source', 'campaign', 'sender')
  ),
  CONSTRAINT global_kill_switch_has_no_scope_id CHECK (
    scope_type <> 'global' OR scope_id IS NULL
  ),
  CONSTRAINT scoped_kill_switch_has_scope_id CHECK (
    scope_type = 'global' OR scope_id IS NOT NULL
  ),
  CONSTRAINT kill_switch_release_consistent CHECK (
    (active AND released_at IS NULL AND released_by IS NULL)
    OR
    (NOT active AND released_at IS NOT NULL AND released_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS kill_switch_scope_index
  ON kill_switches (scope_type, scope_id);
CREATE INDEX IF NOT EXISTS kill_switch_active_index
  ON kill_switches (active);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_kill_switch_per_scope
  ON kill_switches (scope_type, COALESCE(scope_id, '__global__'))
  WHERE active;

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  actor_type text NOT NULL,
  actor_id text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  before_json jsonb,
  after_json jsonb,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_actor_type CHECK (actor_type IN ('human', 'system', 'agent'))
);

CREATE INDEX IF NOT EXISTS audit_log_entity_index
  ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_created_at_index
  ON audit_log (created_at);

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
CREATE TRIGGER audit_log_append_only
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TABLE IF NOT EXISTS regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  timezone_strategy text NOT NULL DEFAULT 'recipient_local',
  default_language text NOT NULL DEFAULT 'en',
  policy_mode text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  policy_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT region_policy_mode CHECK (
    policy_mode IN ('draft_only', 'approval_required', 'autonomous_allowlist', 'block')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS regions_code_unique ON regions (code);

CREATE TABLE IF NOT EXISTS system_settings (
  key text PRIMARY KEY,
  value_json jsonb NOT NULL,
  sensitive boolean NOT NULL DEFAULT false,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
