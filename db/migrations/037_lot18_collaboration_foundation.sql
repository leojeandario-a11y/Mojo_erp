BEGIN;

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN (
    'approval_needed', 'invoice_overdue', 'payment_expected', 'low_stock', 'contract_expiring',
    'budget_exceeded', 'project_late', 'hr_request', 'fund_withdrawal', 'fund_target_reached',
    'monthly_report', 'rent_due', 'scheduled_report', 'announcement', 'meeting_invitation',
    'meeting_update', 'meeting_response', 'chat_message', 'system'
  ));

INSERT INTO permissions(code, module)
VALUES
  ('collaboration.announcement.global', 'collaboration'),
  ('collaboration.announcement.department', 'collaboration'),
  ('collaboration.meeting.schedule', 'collaboration'),
  ('collaboration.chat.group.create', 'collaboration'),
  ('collaboration.chat.directors.read', 'collaboration')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.code = 'dg'
  AND permission.code IN (
    'collaboration.announcement.global',
    'collaboration.meeting.schedule',
    'collaboration.chat.group.create',
    'collaboration.chat.directors.read'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.code IN ('daf', 'drh', 'affaires', 'marketing', 'operations', 'stock_manager')
  AND permission.code IN (
    'collaboration.announcement.department',
    'collaboration.meeting.schedule',
    'collaboration.chat.group.create',
    'collaboration.chat.directors.read'
  )
ON CONFLICT DO NOTHING;

CREATE TABLE collaboration_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  audience_type text NOT NULL CHECK (audience_type IN ('all', 'department', 'selected')),
  department_code text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (audience_type = 'department' AND department_code IS NOT NULL)
    OR (audience_type <> 'department' AND department_code IS NULL)
  )
);
CREATE INDEX idx_collaboration_announcements_creator
  ON collaboration_announcements(created_by, created_at DESC);
GRANT SELECT, INSERT ON collaboration_announcements TO mojo_app;

CREATE TABLE collaboration_announcement_recipients (
  announcement_id uuid NOT NULL REFERENCES collaboration_announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (announcement_id, user_id)
);
CREATE INDEX idx_collaboration_announcement_recipients_user
  ON collaboration_announcement_recipients(user_id, announcement_id);
GRANT SELECT, INSERT ON collaboration_announcement_recipients TO mojo_app;

CREATE FUNCTION collaboration_announcement_owner(target_id uuid, viewer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM collaboration_announcements announcement
    WHERE announcement.id = target_id AND announcement.created_by = viewer_id
  )
$$;
REVOKE ALL ON FUNCTION collaboration_announcement_owner(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collaboration_announcement_owner(uuid, uuid) TO mojo_app;

CREATE FUNCTION collaboration_announcement_recipient(target_id uuid, viewer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM collaboration_announcement_recipients recipient
    WHERE recipient.announcement_id = target_id AND recipient.user_id = viewer_id
  )
$$;
REVOKE ALL ON FUNCTION collaboration_announcement_recipient(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collaboration_announcement_recipient(uuid, uuid) TO mojo_app;

ALTER TABLE collaboration_announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY collaboration_announcements_read ON collaboration_announcements
  FOR SELECT
  USING (
    created_by = app_user_id()
    OR collaboration_announcement_recipient(id, app_user_id())
  );
CREATE POLICY collaboration_announcements_create ON collaboration_announcements
  FOR INSERT
  WITH CHECK (
    created_by = app_user_id()
    AND (
      app_has_permission('collaboration.announcement.global')
      OR app_has_permission('collaboration.announcement.department')
    )
  );

ALTER TABLE collaboration_announcement_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY collaboration_announcement_recipients_read ON collaboration_announcement_recipients
  FOR SELECT
  USING (
    user_id = app_user_id()
    OR collaboration_announcement_owner(announcement_id, app_user_id())
  );
CREATE POLICY collaboration_announcement_recipients_create ON collaboration_announcement_recipients
  FOR INSERT
  WITH CHECK (collaboration_announcement_owner(announcement_id, app_user_id()));

CREATE TABLE notification_email_queue (
  notification_id uuid PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  queued_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_at timestamptz,
  sent_at timestamptz,
  last_error text
);
CREATE INDEX idx_notification_email_queue_pending
  ON notification_email_queue(queued_at)
  WHERE sent_at IS NULL AND attempts < 5;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_email_queue TO mojo_app;

CREATE FUNCTION queue_notification_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO notification_email_queue(notification_id, user_id)
  SELECT NEW.id, NEW.user_id
  FROM users user_record
  WHERE user_record.id = NEW.user_id AND user_record.is_active
  ON CONFLICT (notification_id) DO NOTHING;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION queue_notification_email() FROM PUBLIC;

CREATE TRIGGER trg_notification_email_queue
AFTER INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION queue_notification_email();

COMMIT;
