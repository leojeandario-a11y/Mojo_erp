-- 025_badge_account_registration.sql : cartes autorisées et inscription contrôlée

CREATE TABLE authorized_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_id text NOT NULL UNIQUE,
  full_name text NOT NULL,
  job_title text,
  department_id uuid NOT NULL REFERENCES departments(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_authorized_badges_upd
BEFORE UPDATE ON authorized_badges
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE account_registration_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_id uuid NOT NULL REFERENCES authorized_badges(id),
  full_name text NOT NULL,
  email citext NOT NULL,
  department_id uuid NOT NULL REFERENCES departments(id),
  password_hash text NOT NULL,
  otp_hash text NOT NULL,
  otp_attempts int NOT NULL DEFAULT 0 CHECK (otp_attempts >= 0),
  otp_expires_at timestamptz NOT NULL,
  otp_verified_at timestamptz,
  status text NOT NULL DEFAULT 'otp_pending'
    CHECK (status IN ('otp_pending','pending_approval','approved','rejected','expired')),
  rejection_reason text,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);

CREATE INDEX idx_account_registration_status ON account_registration_requests(status, created_at DESC);
CREATE INDEX idx_account_registration_badge ON account_registration_requests(badge_id);

CREATE TRIGGER trg_account_registration_requests_upd
BEFORE UPDATE ON account_registration_requests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION reject_duplicate_pending_registration()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM account_registration_requests r
    WHERE r.badge_id = NEW.badge_id
      AND r.status IN ('otp_pending', 'pending_approval', 'approved')
      AND r.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) THEN
    RAISE EXCEPTION 'An active registration request already exists for this badge.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_account_registration_badge_unique
BEFORE INSERT OR UPDATE OF badge_id, status ON account_registration_requests
FOR EACH ROW EXECUTE FUNCTION reject_duplicate_pending_registration();

CREATE UNIQUE INDEX uq_active_registration_badge
ON account_registration_requests(badge_id)
WHERE status IN ('otp_pending', 'pending_approval', 'approved');
