BEGIN;

CREATE FUNCTION collaboration_user_is_director(target_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles user_role
    JOIN roles role ON role.id = user_role.role_id
    WHERE user_role.user_id = target_user
      AND role.code IN ('dg', 'daf', 'drh', 'affaires', 'marketing', 'operations', 'stock_manager')
  )
$$;
REVOKE ALL ON FUNCTION collaboration_user_is_director(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collaboration_user_is_director(uuid) TO mojo_app;

CREATE TABLE collaboration_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  meet_url text,
  google_event_id text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CHECK (ends_at > starts_at),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
CREATE INDEX idx_collaboration_meetings_start
  ON collaboration_meetings(starts_at DESC)
  WHERE status = 'scheduled';
GRANT SELECT, INSERT, UPDATE ON collaboration_meetings TO mojo_app;

CREATE TABLE collaboration_meeting_invitees (
  meeting_id uuid NOT NULL REFERENCES collaboration_meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response text NOT NULL DEFAULT 'pending'
    CHECK (response IN ('pending', 'accepted', 'declined', 'tentative')),
  responded_at timestamptz,
  PRIMARY KEY (meeting_id, user_id),
  CHECK ((response = 'pending') = (responded_at IS NULL))
);
CREATE INDEX idx_collaboration_meeting_invitees_user
  ON collaboration_meeting_invitees(user_id, meeting_id);
GRANT SELECT, INSERT, UPDATE ON collaboration_meeting_invitees TO mojo_app;

CREATE FUNCTION collaboration_meeting_owner(target_id uuid, viewer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM collaboration_meetings meeting
    WHERE meeting.id = target_id AND meeting.created_by = viewer_id
  )
$$;
REVOKE ALL ON FUNCTION collaboration_meeting_owner(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collaboration_meeting_owner(uuid, uuid) TO mojo_app;

CREATE FUNCTION collaboration_meeting_invitee(target_id uuid, viewer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM collaboration_meeting_invitees invitee
    WHERE invitee.meeting_id = target_id AND invitee.user_id = viewer_id
  )
$$;
REVOKE ALL ON FUNCTION collaboration_meeting_invitee(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collaboration_meeting_invitee(uuid, uuid) TO mojo_app;

ALTER TABLE collaboration_meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY collaboration_meetings_read ON collaboration_meetings
  FOR SELECT
  USING (
    created_by = app_user_id()
    OR collaboration_meeting_invitee(id, app_user_id())
  );
CREATE POLICY collaboration_meetings_create ON collaboration_meetings
  FOR INSERT
  WITH CHECK (
    created_by = app_user_id()
    AND app_has_permission('collaboration.meeting.schedule')
    AND collaboration_user_is_director(app_user_id())
  );
CREATE POLICY collaboration_meetings_update ON collaboration_meetings
  FOR UPDATE
  USING (created_by = app_user_id())
  WITH CHECK (created_by = app_user_id());

ALTER TABLE collaboration_meeting_invitees ENABLE ROW LEVEL SECURITY;
CREATE POLICY collaboration_meeting_invitees_read ON collaboration_meeting_invitees
  FOR SELECT
  USING (
    user_id = app_user_id()
    OR collaboration_meeting_owner(meeting_id, app_user_id())
  );
CREATE POLICY collaboration_meeting_invitees_create ON collaboration_meeting_invitees
  FOR INSERT
  WITH CHECK (collaboration_meeting_owner(meeting_id, app_user_id()));
CREATE POLICY collaboration_meeting_invitees_respond ON collaboration_meeting_invitees
  FOR UPDATE
  USING (user_id = app_user_id())
  WITH CHECK (user_id = app_user_id());

CALL attach_audit('collaboration_meetings', 'collaboration');
CALL attach_audit('collaboration_meeting_invitees', 'collaboration');

CREATE TABLE collaboration_chat_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('direct', 'group', 'directors')),
  title text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'direct' AND title IS NULL)
    OR (kind <> 'direct' AND length(title) BETWEEN 1 AND 120)
  )
);
GRANT SELECT, INSERT ON collaboration_chat_rooms TO mojo_app;

CREATE TABLE collaboration_chat_members (
  room_id uuid NOT NULL REFERENCES collaboration_chat_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX idx_collaboration_chat_members_user
  ON collaboration_chat_members(user_id, room_id);
GRANT SELECT, INSERT ON collaboration_chat_members TO mojo_app;

CREATE TABLE collaboration_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES collaboration_chat_rooms(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_collaboration_chat_messages_room
  ON collaboration_chat_messages(room_id, created_at DESC);
GRANT SELECT, INSERT ON collaboration_chat_messages TO mojo_app;

CREATE FUNCTION collaboration_chat_member(target_room uuid, viewer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM collaboration_chat_members member
    WHERE member.room_id = target_room AND member.user_id = viewer_id
  )
$$;
REVOKE ALL ON FUNCTION collaboration_chat_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collaboration_chat_member(uuid, uuid) TO mojo_app;

CREATE FUNCTION collaboration_chat_room_owner(target_room uuid, viewer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM collaboration_chat_rooms room
    WHERE room.id = target_room AND room.created_by = viewer_id
  )
$$;
REVOKE ALL ON FUNCTION collaboration_chat_room_owner(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collaboration_chat_room_owner(uuid, uuid) TO mojo_app;

ALTER TABLE collaboration_chat_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY collaboration_chat_rooms_read ON collaboration_chat_rooms
  FOR SELECT
  USING (
    created_by = app_user_id()
    OR collaboration_chat_member(id, app_user_id())
    OR (
      kind = 'directors'
      AND app_has_permission('collaboration.chat.directors.read')
      AND collaboration_user_is_director(app_user_id())
    )
  );
CREATE POLICY collaboration_chat_rooms_create ON collaboration_chat_rooms
  FOR INSERT
  WITH CHECK (
    created_by = app_user_id()
    AND (
      kind = 'direct'
      OR (
        kind IN ('group', 'directors')
        AND app_has_permission('collaboration.chat.group.create')
        AND collaboration_user_is_director(app_user_id())
      )
    )
  );

ALTER TABLE collaboration_chat_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY collaboration_chat_members_read ON collaboration_chat_members
  FOR SELECT
  USING (
    user_id = app_user_id()
    OR collaboration_chat_member(room_id, app_user_id())
    OR collaboration_chat_room_owner(room_id, app_user_id())
    OR (
      app_has_permission('collaboration.chat.directors.read')
      AND collaboration_user_is_director(app_user_id())
      AND EXISTS (
        SELECT 1 FROM collaboration_chat_rooms room
        WHERE room.id = room_id AND room.kind = 'directors'
      )
    )
  );
CREATE POLICY collaboration_chat_members_add ON collaboration_chat_members
  FOR INSERT
  WITH CHECK (
    (
      collaboration_chat_room_owner(room_id, app_user_id())
      AND EXISTS (
        SELECT 1
        FROM collaboration_chat_rooms room
        WHERE room.id = room_id
          AND (
            room.kind = 'direct'
            AND cardinality(string_to_array(room.room_key, ':')) = 3
            AND room.room_key = 'direct:'
              || LEAST(split_part(room.room_key, ':', 2), split_part(room.room_key, ':', 3))
              || ':'
              || GREATEST(split_part(room.room_key, ':', 2), split_part(room.room_key, ':', 3))
            AND room.created_by::text = ANY(string_to_array(room.room_key, ':'))
            AND user_id::text = ANY(string_to_array(room.room_key, ':'))
            OR (
              room.kind = 'group'
              AND app_has_permission('collaboration.chat.group.create')
              AND collaboration_user_is_director(app_user_id())
            )
            OR (
              room.kind = 'directors'
              AND app_has_permission('collaboration.chat.group.create')
              AND collaboration_user_is_director(app_user_id())
              AND collaboration_user_is_director(user_id)
            )
          )
      )
    )
    OR (
      app_has_permission('collaboration.chat.group.create')
      AND collaboration_user_is_director(app_user_id())
      AND collaboration_user_is_director(user_id)
      AND EXISTS (
        SELECT 1 FROM collaboration_chat_rooms room
        WHERE room.id = room_id AND room.kind = 'directors'
      )
    )
    OR (
      user_id = app_user_id()
      AND app_has_permission('collaboration.chat.directors.read')
      AND collaboration_user_is_director(app_user_id())
      AND EXISTS (
        SELECT 1 FROM collaboration_chat_rooms room
        WHERE room.id = room_id AND room.kind = 'directors'
      )
    )
  );

ALTER TABLE collaboration_chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY collaboration_chat_messages_read ON collaboration_chat_messages
  FOR SELECT
  USING (collaboration_chat_member(room_id, app_user_id()));
CREATE POLICY collaboration_chat_messages_send ON collaboration_chat_messages
  FOR INSERT
  WITH CHECK (
    sender_id = app_user_id()
    AND collaboration_chat_member(room_id, app_user_id())
  );

CREATE OR REPLACE FUNCTION queue_notification_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.kind <> 'chat_message' THEN
    INSERT INTO notification_email_queue(notification_id, user_id)
    SELECT NEW.id, user_record.id
    FROM users user_record
    WHERE user_record.id = NEW.user_id AND user_record.is_active
    ON CONFLICT (notification_id) DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION queue_notification_email() FROM PUBLIC;

COMMIT;
