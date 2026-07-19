CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  founder_id uuid REFERENCES founders(id) ON DELETE RESTRICT,
  source_document_id uuid NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  full_name text,
  role text,
  channel_type text NOT NULL,
  value text NOT NULL,
  normalized_value text NOT NULL,
  direct_url text NOT NULL,
  source_url text NOT NULL,
  origin text NOT NULL,
  provenance text NOT NULL,
  verification_status text NOT NULL DEFAULT 'unverified',
  verification_provider text,
  is_personal_data boolean NOT NULL DEFAULT false,
  corporate_subscriber_status text NOT NULL DEFAULT 'unknown',
  country text,
  confidence real NOT NULL,
  do_not_contact boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_channel_known CHECK (
    channel_type IN (
      'named_business_email',
      'corporate_email',
      'contact_form',
      'linkedin',
      'instagram',
      'platform_application'
    )
  ),
  CONSTRAINT contact_origin_known CHECK (
    origin IN (
      'published_public',
      'verification_provider',
      'data_broker',
      'inferred_pattern',
      'manual'
    )
  ),
  CONSTRAINT contact_verification_known CHECK (
    verification_status IN (
      'unverified',
      'published_verified',
      'syntax_valid',
      'mx_valid',
      'provider_verified',
      'risky',
      'invalid',
      'manual_review'
    )
  ),
  CONSTRAINT contact_confidence_range CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT contact_corporate_subscriber_known CHECK (
    corporate_subscriber_status IN ('unknown', 'corporate', 'individual')
  ),
  CONSTRAINT contact_inferred_never_verified CHECK (
    origin <> 'inferred_pattern'
    OR verification_status NOT IN ('published_verified', 'provider_verified')
  ),
  CONSTRAINT contact_provider_verification_consistent CHECK (
    verification_status <> 'provider_verified'
    OR verification_provider IS NOT NULL
  ),
  CONSTRAINT contact_broker_verification_consistent CHECK (
    origin <> 'data_broker'
    OR verification_status <> 'provider_verified'
    OR verification_provider IS NOT NULL
  )
);

CREATE UNIQUE INDEX contacts_organization_channel_value_unique
  ON contacts (organization_id, channel_type, normalized_value);
CREATE INDEX contacts_organization_index ON contacts (organization_id);
CREATE INDEX contacts_verification_index ON contacts (verification_status);
CREATE INDEX contacts_evidence_index ON contacts (evidence_id);

CREATE OR REPLACE FUNCTION validate_contact_association()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM evidence e
    JOIN leads l ON l.id = e.lead_id
    JOIN source_documents sd ON sd.id = e.source_document_id
    WHERE e.id = NEW.evidence_id
      AND e.source_document_id = NEW.source_document_id
      AND sd.canonical_url = NEW.source_url
      AND e.state = 'active'
      AND l.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'contact evidence/source/organization association is invalid';
  END IF;

  IF NEW.founder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM founders f
    WHERE f.id = NEW.founder_id
      AND f.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'contact founder/organization association is invalid';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER contacts_association_valid
BEFORE INSERT ON contacts
FOR EACH ROW
EXECUTE FUNCTION validate_contact_association();

CREATE OR REPLACE FUNCTION protect_contact_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'contacts cannot be deleted physically';
  END IF;

  IF
    OLD.organization_id IS DISTINCT FROM NEW.organization_id
    OR OLD.founder_id IS DISTINCT FROM NEW.founder_id
    OR OLD.source_document_id IS DISTINCT FROM NEW.source_document_id
    OR OLD.evidence_id IS DISTINCT FROM NEW.evidence_id
    OR OLD.full_name IS DISTINCT FROM NEW.full_name
    OR OLD.role IS DISTINCT FROM NEW.role
    OR OLD.channel_type IS DISTINCT FROM NEW.channel_type
    OR OLD.value IS DISTINCT FROM NEW.value
    OR OLD.normalized_value IS DISTINCT FROM NEW.normalized_value
    OR OLD.direct_url IS DISTINCT FROM NEW.direct_url
    OR OLD.source_url IS DISTINCT FROM NEW.source_url
    OR OLD.origin IS DISTINCT FROM NEW.origin
    OR OLD.provenance IS DISTINCT FROM NEW.provenance
    OR OLD.is_personal_data IS DISTINCT FROM NEW.is_personal_data
    OR OLD.country IS DISTINCT FROM NEW.country
    OR OLD.confidence IS DISTINCT FROM NEW.confidence
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'contact identity and provenance are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER contacts_identity_immutable
BEFORE UPDATE OR DELETE ON contacts
FOR EACH ROW
EXECUTE FUNCTION protect_contact_identity();

CREATE TABLE contact_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  status text NOT NULL,
  provider text,
  syntax_valid boolean NOT NULL,
  mx_found boolean NOT NULL,
  provider_verdict text NOT NULL,
  reason text NOT NULL,
  checked_at timestamptz NOT NULL,
  result_json jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_verification_history_status_known CHECK (
    status IN (
      'unverified',
      'published_verified',
      'syntax_valid',
      'mx_valid',
      'provider_verified',
      'risky',
      'invalid',
      'manual_review'
    )
  ),
  CONSTRAINT contact_verification_provider_verdict_known CHECK (
    provider_verdict IN ('verified', 'invalid', 'risky', 'unknown')
  ),
  CONSTRAINT contact_verification_history_provider_consistent CHECK (
    status <> 'provider_verified' OR provider IS NOT NULL
  )
);

CREATE INDEX contact_verifications_contact_index
  ON contact_verifications (contact_id, checked_at);

CREATE OR REPLACE FUNCTION protect_contact_verification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'contact verifications are append-only';
END;
$$;

CREATE TRIGGER contact_verifications_append_only
BEFORE UPDATE OR DELETE ON contact_verifications
FOR EACH ROW
EXECUTE FUNCTION protect_contact_verification();
