ALTER TABLE gmail_credentials
  DROP CONSTRAINT gmail_credential_scopes_array;
ALTER TABLE gmail_credentials
  ADD CONSTRAINT gmail_credential_scopes_array CHECK (
    jsonb_typeof(scopes_json) = 'array'
    AND scopes_json ? 'https://www.googleapis.com/auth/gmail.send'
  );

ALTER TABLE outbound_messages ADD COLUMN bounce_type text;
ALTER TABLE outbound_messages
  ADD CONSTRAINT outbound_bounce_type_known CHECK (
    bounce_type IS NULL OR bounce_type IN ('hard', 'soft', 'unknown')
  );

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
    OR (OLD.bounce_type IS NOT NULL AND OLD.bounce_type IS DISTINCT FROM NEW.bounce_type)
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

ALTER TABLE outbox_events DROP CONSTRAINT outbox_event_type_known;
ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_event_type_known CHECK (
    event_type IN ('sequence.start', 'sequence.stop')
  );

CREATE TABLE gmail_sync_cursors (
  sender_id uuid PRIMARY KEY REFERENCES senders(id) ON DELETE RESTRICT,
  history_id text NOT NULL,
  initialized_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gmail_history_id_numeric CHECK (history_id ~ '^[0-9]+$')
);

CREATE OR REPLACE FUNCTION protect_gmail_sync_cursor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Gmail sync cursors cannot be deleted physically';
  END IF;
  IF
    OLD.sender_id IS DISTINCT FROM NEW.sender_id
    OR OLD.initialized_at IS DISTINCT FROM NEW.initialized_at
    OR NEW.history_id::numeric < OLD.history_id::numeric
  THEN
    RAISE EXCEPTION 'Gmail sync cursor identity is immutable and history is monotonic';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER gmail_sync_cursor_protected
BEFORE UPDATE OR DELETE ON gmail_sync_cursors
FOR EACH ROW
EXECUTE FUNCTION protect_gmail_sync_cursor();

CREATE TABLE inbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_message_id text NOT NULL,
  thread_id text NOT NULL,
  sender_id uuid NOT NULL REFERENCES senders(id) ON DELETE RESTRICT,
  sequence_id uuid NOT NULL REFERENCES sequences(id) ON DELETE RESTRICT,
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  association_type text NOT NULL,
  from_address text NOT NULL,
  to_address text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  body_hash text NOT NULL,
  received_at timestamptz NOT NULL,
  provider_headers_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbound_provider_message_unique UNIQUE (provider_message_id),
  CONSTRAINT inbound_association_type_known CHECK (
    association_type IN ('contact_reply', 'provider_bounce')
  ),
  CONSTRAINT inbound_from_normalized CHECK (from_address = lower(trim(from_address))),
  CONSTRAINT inbound_to_normalized CHECK (to_address = lower(trim(to_address))),
  CONSTRAINT inbound_body_hash_shape CHECK (body_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT inbound_body_size CHECK (length(body_text) <= 50000),
  CONSTRAINT inbound_headers_object CHECK (jsonb_typeof(provider_headers_json) = 'object')
);

CREATE INDEX inbound_received_index ON inbound_messages (received_at DESC);
CREATE INDEX inbound_sequence_index ON inbound_messages (sequence_id, received_at);

CREATE OR REPLACE FUNCTION validate_inbound_association()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sequences sequence
    JOIN contacts contact ON contact.id = sequence.contact_id
    JOIN senders sender ON sender.id = sequence.sender_id
    JOIN outbound_messages outbound ON outbound.sequence_id = sequence.id
    WHERE sequence.id = NEW.sequence_id
      AND sequence.lead_id = NEW.lead_id
      AND sequence.sender_id = NEW.sender_id
      AND sender.email = NEW.to_address
      AND outbound.thread_id = NEW.thread_id
      AND outbound.delivery_status = 'sent'
      AND (
        (
          NEW.association_type = 'contact_reply'
          AND contact.normalized_value = NEW.from_address
        )
        OR (
          NEW.association_type = 'provider_bounce'
          AND split_part(NEW.from_address, '@', 1) IN ('mailer-daemon', 'postmaster')
          AND (
            split_part(NEW.from_address, '@', 2) IN ('googlemail.com', 'gmail.com')
            OR split_part(NEW.from_address, '@', 2) = split_part(contact.normalized_value, '@', 2)
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'inbound message does not match a sent CRM thread and contact';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER inbound_association_valid
BEFORE INSERT ON inbound_messages
FOR EACH ROW
EXECUTE FUNCTION validate_inbound_association();

CREATE OR REPLACE FUNCTION protect_inbound_message()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'inbound messages are immutable and append-only';
END;
$$;

CREATE TRIGGER inbound_messages_append_only
BEFORE UPDATE OR DELETE ON inbound_messages
FOR EACH ROW
EXECUTE FUNCTION protect_inbound_message();

CREATE TABLE reply_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_message_id uuid NOT NULL REFERENCES inbound_messages(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  classifier_version text NOT NULL,
  classification text NOT NULL,
  confidence real NOT NULL,
  sentiment text NOT NULL,
  requested_action text NOT NULL,
  suppression_required boolean NOT NULL,
  follow_up_date date,
  evidence_snippets_json jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reply_classification_version_unique UNIQUE (inbound_message_id, version),
  CONSTRAINT reply_classification_version_positive CHECK (version > 0),
  CONSTRAINT reply_classification_known CHECK (
    classification IN (
      'positive', 'curious', 'asks_for_details', 'referral', 'later',
      'no_interest', 'unsubscribe', 'out_of_office', 'wrong_person',
      'bounce', 'hostile', 'complaint', 'ambiguous'
    )
  ),
  CONSTRAINT reply_confidence_range CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT reply_sentiment_known CHECK (
    sentiment IN ('positive', 'neutral', 'negative', 'automated')
  ),
  CONSTRAINT reply_requested_action_known CHECK (
    requested_action IN (
      'handoff', 'follow_up_later', 'suppress', 'archive', 'manual_review', 'update_contact'
    )
  ),
  CONSTRAINT reply_suppression_required CHECK (
    classification NOT IN ('unsubscribe', 'complaint', 'bounce')
    OR suppression_required = true
  ),
  CONSTRAINT reply_evidence_array CHECK (jsonb_typeof(evidence_snippets_json) = 'array')
);

CREATE INDEX reply_classification_inbound_index
  ON reply_classifications (inbound_message_id, created_at);

CREATE OR REPLACE FUNCTION protect_reply_classification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'reply classifications are append-only';
END;
$$;

CREATE TRIGGER reply_classifications_append_only
BEFORE UPDATE OR DELETE ON reply_classifications
FOR EACH ROW
EXECUTE FUNCTION protect_reply_classification();

CREATE TABLE handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  reply_id uuid NOT NULL REFERENCES inbound_messages(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  packet_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ready',
  created_by text NOT NULL,
  owned_by text,
  owned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT handoff_reply_version_unique UNIQUE (reply_id, version),
  CONSTRAINT handoff_version_positive CHECK (version > 0),
  CONSTRAINT handoff_packet_object CHECK (jsonb_typeof(packet_json) = 'object'),
  CONSTRAINT handoff_status_known CHECK (status IN ('ready', 'owned')),
  CONSTRAINT handoff_owned_shape CHECK (
    (status = 'owned' AND owned_by IS NOT NULL AND owned_at IS NOT NULL)
    OR (status = 'ready' AND owned_by IS NULL AND owned_at IS NULL)
  )
);

CREATE INDEX handoffs_status_created_index ON handoffs (status, created_at DESC);

CREATE OR REPLACE FUNCTION validate_handoff_association()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM inbound_messages inbound
    WHERE inbound.id = NEW.reply_id
      AND inbound.lead_id = NEW.lead_id
  ) THEN
    RAISE EXCEPTION 'handoff reply and lead association is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER handoff_association_valid
BEFORE INSERT ON handoffs
FOR EACH ROW
EXECUTE FUNCTION validate_handoff_association();

CREATE OR REPLACE FUNCTION protect_handoff()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'handoffs cannot be deleted physically';
  END IF;
  IF
    OLD.lead_id IS DISTINCT FROM NEW.lead_id
    OR OLD.reply_id IS DISTINCT FROM NEW.reply_id
    OR OLD.version IS DISTINCT FROM NEW.version
    OR OLD.packet_json IS DISTINCT FROM NEW.packet_json
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.status = 'owned'
    OR NOT (OLD.status = 'ready' AND NEW.status = 'owned')
  THEN
    RAISE EXCEPTION 'handoff content is immutable and ownership is one-way';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER handoffs_protected
BEFORE UPDATE OR DELETE ON handoffs
FOR EACH ROW
EXECUTE FUNCTION protect_handoff();

CREATE TABLE internal_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  handoff_id uuid NOT NULL REFERENCES handoffs(id) ON DELETE RESTRICT,
  recipient text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_handoff_unique UNIQUE (handoff_id),
  CONSTRAINT notification_type_reply CHECK (type = 'reply_needs_mateo')
);

CREATE INDEX internal_notifications_unread_index
  ON internal_notifications (recipient, read_at, created_at DESC);

CREATE OR REPLACE FUNCTION protect_internal_notification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'internal notifications cannot be deleted physically';
  END IF;
  IF
    OLD.type IS DISTINCT FROM NEW.type
    OR OLD.handoff_id IS DISTINCT FROM NEW.handoff_id
    OR OLD.recipient IS DISTINCT FROM NEW.recipient
    OR OLD.title IS DISTINCT FROM NEW.title
    OR OLD.body IS DISTINCT FROM NEW.body
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.read_at IS NOT NULL
    OR NEW.read_at IS NULL
  THEN
    RAISE EXCEPTION 'notification content is immutable and read state is one-way';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER internal_notifications_protected
BEFORE UPDATE OR DELETE ON internal_notifications
FOR EACH ROW
EXECUTE FUNCTION protect_internal_notification();

CREATE TABLE recheck_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  inbound_message_id uuid NOT NULL REFERENCES inbound_messages(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recheck_inbound_unique UNIQUE (inbound_message_id),
  CONSTRAINT recheck_status_known CHECK (status IN ('pending', 'completed', 'cancelled')),
  CONSTRAINT recheck_completion_shape CHECK (
    (status = 'pending' AND completed_at IS NULL)
    OR (status IN ('completed', 'cancelled') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX recheck_tasks_pending_index ON recheck_tasks (status, scheduled_at);

CREATE OR REPLACE FUNCTION validate_recheck_association()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM inbound_messages inbound
    WHERE inbound.id = NEW.inbound_message_id
      AND inbound.lead_id = NEW.lead_id
  ) THEN
    RAISE EXCEPTION 'recheck task reply and lead association is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER recheck_association_valid
BEFORE INSERT ON recheck_tasks
FOR EACH ROW
EXECUTE FUNCTION validate_recheck_association();

CREATE OR REPLACE FUNCTION protect_recheck_task()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'recheck tasks cannot be deleted physically';
  END IF;
  IF
    OLD.lead_id IS DISTINCT FROM NEW.lead_id
    OR OLD.inbound_message_id IS DISTINCT FROM NEW.inbound_message_id
    OR OLD.reason IS DISTINCT FROM NEW.reason
    OR OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.status <> 'pending'
    OR NEW.status NOT IN ('completed', 'cancelled')
  THEN
    RAISE EXCEPTION 'recheck task identity is immutable and completion is one-way';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER recheck_tasks_protected
BEFORE UPDATE OR DELETE ON recheck_tasks
FOR EACH ROW
EXECUTE FUNCTION protect_recheck_task();
