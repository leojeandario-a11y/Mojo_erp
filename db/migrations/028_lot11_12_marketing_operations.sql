BEGIN;

ALTER TABLE marketing_campaigns
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'draft'
    CHECK (approval_status IN ('draft','pending_dg','approved','rejected'));

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'draft'
    CHECK (approval_status IN ('draft','pending_dg','approved','rejected')),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none'
    CHECK (recurrence IN ('none','daily','weekly','monthly')),
  ADD COLUMN IF NOT EXISTS recurrence_until date;

CREATE TABLE IF NOT EXISTS campaign_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  title text NOT NULL,
  document_type text NOT NULL DEFAULT 'other'
    CHECK (document_type IN ('brief','visual','video','copy','report','other')),
  file_url text,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  document_type text NOT NULL DEFAULT 'other',
  file_url text,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prevent_resource_allocation_overlap() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM resource_allocations existing
    WHERE existing.id IS DISTINCT FROM NEW.id
      AND existing.resource_id = NEW.resource_id
      AND existing.from_date <= NEW.to_date
      AND existing.to_date >= NEW.from_date
  ) THEN
    RAISE EXCEPTION 'Resource is already allocated during this period.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resource_allocation_overlap ON resource_allocations;
CREATE TRIGGER trg_resource_allocation_overlap
BEFORE INSERT OR UPDATE ON resource_allocations
FOR EACH ROW EXECUTE FUNCTION prevent_resource_allocation_overlap();

INSERT INTO permissions(code,module)
VALUES
  ('operations.resource.manage','operations'),
  ('operations.activity.manage','operations'),
  ('marketing.content.manage','marketing'),
  ('marketing.report.read','marketing')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='operations.resource.manage'
WHERE r.code IN ('super_admin','operations','project_manager')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='operations.activity.manage'
WHERE r.code IN ('super_admin','operations','project_manager')
ON CONFLICT DO NOTHING;

COMMIT;
