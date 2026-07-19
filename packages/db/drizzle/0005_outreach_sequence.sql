CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  sequence_version text NOT NULL,
  daily_cap integer NOT NULL DEFAULT 10,
  daily_domain_cap integer NOT NULL DEFAULT 1,
  approval_mode text NOT NULL DEFAULT 'approved_send',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_name_unique UNIQUE (name),
  CONSTRAINT campaign_daily_cap_range CHECK (daily_cap BETWEEN 0 AND 500),
  CONSTRAINT campaign_domain_cap_range CHECK (daily_domain_cap BETWEEN 0 AND 50),
  CONSTRAINT campaign_approval_mode_known CHECK (
    approval_mode IN ('draft_only', 'approved_send', 'autonomous_send')
  )
);

CREATE TABLE senders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  sandbox boolean NOT NULL DEFAULT true,
  daily_cap integer NOT NULL DEFAULT 10,
  timezone text NOT NULL DEFAULT 'Europe/Madrid',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sender_email_unique UNIQUE (email),
  CONSTRAINT sender_email_normalized CHECK (email = lower(trim(email))),
  CONSTRAINT sender_daily_cap_range CHECK (daily_cap BETWEEN 0 AND 500)
);

CREATE TABLE gmail_oauth_states (
  state_hash text PRIMARY KEY,
  sender_email text NOT NULL,
  return_path text NOT NULL,
  actor_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gmail_oauth_state_hash_shape CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT gmail_oauth_return_path_internal CHECK (return_path ~ '^/leads/[0-9a-f-]{36}$'),
  CONSTRAINT gmail_oauth_expiry_future CHECK (expires_at > created_at)
);

CREATE OR REPLACE FUNCTION protect_gmail_oauth_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Gmail OAuth states cannot be deleted physically';
  END IF;
  IF
    OLD.state_hash IS DISTINCT FROM NEW.state_hash
    OR OLD.sender_email IS DISTINCT FROM NEW.sender_email
    OR OLD.return_path IS DISTINCT FROM NEW.return_path
    OR OLD.actor_id IS DISTINCT FROM NEW.actor_id
    OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.consumed_at IS NOT NULL
    OR NEW.consumed_at IS NULL
  THEN
    RAISE EXCEPTION 'Gmail OAuth state identity is immutable and consumption is one-way';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER gmail_oauth_state_protected
BEFORE UPDATE OR DELETE ON gmail_oauth_states
FOR EACH ROW
EXECUTE FUNCTION protect_gmail_oauth_state();

CREATE TABLE gmail_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES senders(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  encrypted_refresh_token text NOT NULL,
  scopes_json jsonb NOT NULL,
  granted_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gmail_credential_sender_version_unique UNIQUE (sender_id, version),
  CONSTRAINT gmail_credential_version_positive CHECK (version > 0),
  CONSTRAINT gmail_credential_ciphertext_shape CHECK (
    encrypted_refresh_token LIKE 'v1.%'
  ),
  CONSTRAINT gmail_credential_scopes_array CHECK (
    jsonb_typeof(scopes_json) = 'array'
    AND scopes_json ? 'https://www.googleapis.com/auth/gmail.send'
  )
);

CREATE INDEX gmail_credentials_sender_created_index
  ON gmail_credentials (sender_id, created_at);

CREATE OR REPLACE FUNCTION protect_gmail_credential()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Gmail credentials are append-only';
END;
$$;

CREATE TRIGGER gmail_credentials_append_only
BEFORE UPDATE OR DELETE ON gmail_credentials
FOR EACH ROW
EXECUTE FUNCTION protect_gmail_credential();

CREATE TABLE suppression_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_contact text NOT NULL,
  contact_hash text NOT NULL,
  channel text NOT NULL,
  reason text NOT NULL,
  source text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppression_contact_channel_unique UNIQUE (normalized_contact, channel),
  CONSTRAINT suppression_hash_shape CHECK (contact_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT suppression_channel_email CHECK (channel = 'email')
);

CREATE INDEX suppression_contact_hash_index ON suppression_list (contact_hash);

CREATE OR REPLACE FUNCTION protect_suppression()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'suppression records are append-only';
END;
$$;

CREATE TRIGGER suppression_list_append_only
BEFORE UPDATE OR DELETE ON suppression_list
FOR EACH ROW
EXECUTE FUNCTION protect_suppression();

CREATE OR REPLACE FUNCTION validate_message_approval_not_suppressed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.decision = 'approved' AND EXISTS (
    SELECT 1
    FROM message_drafts draft
    JOIN contacts contact ON contact.id = draft.contact_id
    JOIN suppression_list suppression
      ON suppression.normalized_contact = contact.normalized_value
      AND suppression.channel = 'email'
    WHERE draft.id = NEW.message_draft_id
  ) THEN
    RAISE EXCEPTION 'suppressed contact message cannot be approved';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER message_approval_suppression_valid
BEFORE INSERT ON message_approvals
FOR EACH ROW
EXECUTE FUNCTION validate_message_approval_not_suppressed();

CREATE TABLE sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  sender_id uuid NOT NULL REFERENCES senders(id) ON DELETE RESTRICT,
  workflow_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending_workflow',
  current_step integer NOT NULL DEFAULT 0,
  recipient_timezone text NOT NULL,
  delivery_mode text NOT NULL,
  started_at timestamptz,
  stopped_at timestamptz,
  stop_reason text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sequence_workflow_unique UNIQUE (workflow_id),
  CONSTRAINT sequence_status_known CHECK (
    status IN (
      'pending_workflow',
      'scheduled',
      'active',
      'paused',
      'stopped',
      'completed',
      'start_failed'
    )
  ),
  CONSTRAINT sequence_step_range CHECK (current_step BETWEEN 0 AND 3),
  CONSTRAINT sequence_delivery_mode_known CHECK (
    delivery_mode IN ('dry_run', 'sandbox', 'production')
  ),
  CONSTRAINT sequence_stop_shape CHECK (
    (status IN ('stopped', 'completed', 'start_failed') AND stopped_at IS NOT NULL)
    OR (status NOT IN ('stopped', 'completed', 'start_failed') AND stopped_at IS NULL)
  )
);

CREATE UNIQUE INDEX sequences_one_active_lead_campaign
  ON sequences (lead_id, campaign_id)
  WHERE status NOT IN ('stopped', 'completed', 'start_failed');
CREATE INDEX sequences_status_index ON sequences (status, updated_at);

CREATE OR REPLACE FUNCTION validate_sequence_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  lead_organization_id uuid;
  approved_current_drafts integer;
BEGIN
  SELECT organization_id
  INTO lead_organization_id
  FROM leads
  WHERE id = NEW.lead_id
    AND status = 'approval_pending';
  IF lead_organization_id IS NULL THEN
    RAISE EXCEPTION 'sequence requires an approval_pending lead';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM contacts c
    WHERE c.id = NEW.contact_id
      AND c.organization_id = lead_organization_id
      AND c.channel_type IN ('corporate_email', 'named_business_email')
      AND c.do_not_contact = false
      AND c.origin <> 'inferred_pattern'
      AND c.verification_status IN ('published_verified', 'provider_verified')
  ) THEN
    RAISE EXCEPTION 'sequence requires an actionable email contact';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM contacts c
    JOIN suppression_list suppression
      ON suppression.normalized_contact = c.normalized_value
      AND suppression.channel = 'email'
    WHERE c.id = NEW.contact_id
  ) THEN
    RAISE EXCEPTION 'suppressed contact cannot be scheduled';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM campaigns campaign
    WHERE campaign.id = NEW.campaign_id
      AND campaign.active = true
      AND campaign.approval_mode = 'approved_send'
  ) THEN
    RAISE EXCEPTION 'sequence requires an active approved-send campaign';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM senders sender
    WHERE sender.id = NEW.sender_id
      AND (
        NEW.delivery_mode = 'dry_run'
        OR (
          sender.active = true
          AND EXISTS (
            SELECT 1 FROM gmail_credentials credential
            WHERE credential.sender_id = sender.id
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'external sequence requires an active Gmail-connected sender';
  END IF;

  SELECT count(*)
  INTO approved_current_drafts
  FROM message_drafts draft
  WHERE draft.lead_id = NEW.lead_id
    AND draft.contact_id = NEW.contact_id
    AND NOT EXISTS (
      SELECT 1 FROM message_drafts newer
      WHERE newer.supersedes_id = draft.id
    )
    AND EXISTS (
      SELECT 1 FROM message_approvals approval
      WHERE approval.message_draft_id = draft.id
        AND approval.decision = 'approved'
    );

  IF approved_current_drafts <> 3 THEN
    RAISE EXCEPTION 'sequence requires three latest approved message versions';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sequence_insert_valid
BEFORE INSERT ON sequences
FOR EACH ROW
EXECUTE FUNCTION validate_sequence_insert();

CREATE OR REPLACE FUNCTION protect_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sequences cannot be deleted physically';
  END IF;
  IF
    OLD.lead_id IS DISTINCT FROM NEW.lead_id
    OR OLD.contact_id IS DISTINCT FROM NEW.contact_id
    OR OLD.campaign_id IS DISTINCT FROM NEW.campaign_id
    OR OLD.sender_id IS DISTINCT FROM NEW.sender_id
    OR OLD.workflow_id IS DISTINCT FROM NEW.workflow_id
    OR OLD.recipient_timezone IS DISTINCT FROM NEW.recipient_timezone
    OR OLD.delivery_mode IS DISTINCT FROM NEW.delivery_mode
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'sequence identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sequence_identity_protected
BEFORE UPDATE OR DELETE ON sequences
FOR EACH ROW
EXECUTE FUNCTION protect_sequence();

CREATE TABLE outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES sequences(id) ON DELETE RESTRICT,
  message_draft_id uuid NOT NULL REFERENCES message_drafts(id) ON DELETE RESTRICT,
  sequence_step integer NOT NULL,
  provider_message_id text,
  thread_id text,
  internet_message_id text NOT NULL,
  idempotency_key text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  claimed_at timestamptz,
  sent_at timestamptz,
  delivery_status text NOT NULL DEFAULT 'scheduled',
  error text,
  attempt_count integer NOT NULL DEFAULT 0,
  decision_trace_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbound_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT outbound_sequence_step_unique UNIQUE (sequence_id, sequence_step),
  CONSTRAINT outbound_step_range CHECK (sequence_step BETWEEN 1 AND 3),
  CONSTRAINT outbound_status_known CHECK (
    delivery_status IN (
      'scheduled',
      'sending',
      'dry_run',
      'sent',
      'blocked',
      'delivery_unknown',
      'cancelled'
    )
  ),
  CONSTRAINT outbound_attempt_count_positive CHECK (attempt_count >= 0),
  CONSTRAINT outbound_internet_message_id_shape CHECK (
    internet_message_id ~ '^<[^<>[:space:]]+@[^<>[:space:]]+>$'
  )
);

CREATE INDEX outbound_schedule_index
  ON outbound_messages (delivery_status, scheduled_at);
CREATE INDEX outbound_thread_index
  ON outbound_messages (thread_id);

CREATE OR REPLACE FUNCTION validate_outbound_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sequences sequence
    JOIN message_drafts draft ON draft.id = NEW.message_draft_id
    WHERE sequence.id = NEW.sequence_id
      AND draft.lead_id = sequence.lead_id
      AND draft.contact_id = sequence.contact_id
      AND draft.sequence_step = NEW.sequence_step
      AND NEW.idempotency_key = (
        sequence.campaign_id::text || ':' ||
        sequence.lead_id::text || ':' ||
        NEW.sequence_step::text || ':email'
      )
      AND NOT EXISTS (
        SELECT 1 FROM message_drafts newer
        WHERE newer.supersedes_id = draft.id
      )
      AND EXISTS (
        SELECT 1 FROM message_approvals approval
        WHERE approval.message_draft_id = draft.id
          AND approval.decision = 'approved'
      )
  ) THEN
    RAISE EXCEPTION 'outbound message association or idempotency is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbound_insert_valid
BEFORE INSERT ON outbound_messages
FOR EACH ROW
EXECUTE FUNCTION validate_outbound_insert();

CREATE OR REPLACE FUNCTION protect_outbound_message()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'outbound messages cannot be deleted physically';
  END IF;
  IF
    OLD.sequence_id IS DISTINCT FROM NEW.sequence_id
    OR OLD.message_draft_id IS DISTINCT FROM NEW.message_draft_id
    OR OLD.sequence_step IS DISTINCT FROM NEW.sequence_step
    OR OLD.internet_message_id IS DISTINCT FROM NEW.internet_message_id
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at
    OR OLD.decision_trace_json IS DISTINCT FROM NEW.decision_trace_json
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR (OLD.provider_message_id IS NOT NULL AND OLD.provider_message_id IS DISTINCT FROM NEW.provider_message_id)
    OR (OLD.thread_id IS NOT NULL AND OLD.thread_id IS DISTINCT FROM NEW.thread_id)
  THEN
    RAISE EXCEPTION 'outbound message identity and decision trace are immutable';
  END IF;

  IF NOT (
    OLD.delivery_status = NEW.delivery_status
    OR (OLD.delivery_status = 'scheduled' AND NEW.delivery_status IN ('sending', 'blocked', 'cancelled'))
    OR (OLD.delivery_status = 'sending' AND NEW.delivery_status IN ('dry_run', 'sent', 'blocked', 'delivery_unknown'))
  ) THEN
    RAISE EXCEPTION 'outbound delivery transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbound_message_protected
BEFORE UPDATE OR DELETE ON outbound_messages
FOR EACH ROW
EXECUTE FUNCTION protect_outbound_message();

CREATE TABLE send_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbound_message_id uuid NOT NULL REFERENCES outbound_messages(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  attempt_number integer NOT NULL,
  mode text NOT NULL,
  outcome text NOT NULL,
  provider_message_id text,
  thread_id text,
  error_code text,
  error_detail text,
  decision_trace_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT send_attempt_number_unique UNIQUE (outbound_message_id, attempt_number),
  CONSTRAINT send_attempt_number_positive CHECK (attempt_number > 0),
  CONSTRAINT send_attempt_mode_known CHECK (mode IN ('dry_run', 'sandbox', 'production')),
  CONSTRAINT send_attempt_outcome_known CHECK (
    outcome IN ('claimed', 'dry_run', 'sent', 'blocked', 'delivery_unknown')
  )
);

CREATE INDEX send_attempts_outbound_index
  ON send_attempts (outbound_message_id, created_at);

CREATE OR REPLACE FUNCTION protect_send_attempt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'send attempts are append-only';
END;
$$;

CREATE TRIGGER send_attempts_append_only
BEFORE UPDATE OR DELETE ON send_attempts
FOR EACH ROW
EXECUTE FUNCTION protect_send_attempt();

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT outbox_event_type_known CHECK (event_type IN ('sequence.start')),
  CONSTRAINT outbox_status_known CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  CONSTRAINT outbox_attempt_count_positive CHECK (attempt_count >= 0)
);

CREATE INDEX outbox_pending_index
  ON outbox_events (status, available_at);

CREATE OR REPLACE FUNCTION protect_outbox_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'outbox events cannot be deleted physically';
  END IF;
  IF
    OLD.event_type IS DISTINCT FROM NEW.event_type
    OR OLD.aggregate_type IS DISTINCT FROM NEW.aggregate_type
    OR OLD.aggregate_id IS DISTINCT FROM NEW.aggregate_id
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.payload_json IS DISTINCT FROM NEW.payload_json
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'outbox event identity and payload are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_event_protected
BEFORE UPDATE OR DELETE ON outbox_events
FOR EACH ROW
EXECUTE FUNCTION protect_outbox_event();
