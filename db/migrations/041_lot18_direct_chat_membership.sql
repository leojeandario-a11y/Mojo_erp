BEGIN;

DROP POLICY IF EXISTS collaboration_chat_members_add ON collaboration_chat_members;
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
            (
              room.kind = 'direct'
              AND cardinality(string_to_array(room.room_key, ':')) = 3
              AND room.room_key = 'direct:'
                || LEAST(split_part(room.room_key, ':', 2), split_part(room.room_key, ':', 3))
                || ':'
                || GREATEST(split_part(room.room_key, ':', 2), split_part(room.room_key, ':', 3))
              AND room.created_by::text = ANY(string_to_array(room.room_key, ':'))
              AND user_id::text = ANY(string_to_array(room.room_key, ':'))
            )
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
      user_id = app_user_id()
      AND app_has_permission('collaboration.chat.directors.read')
      AND collaboration_user_is_director(app_user_id())
      AND EXISTS (
        SELECT 1 FROM collaboration_chat_rooms room
        WHERE room.id = room_id AND room.kind = 'directors'
      )
    )
  );

COMMIT;
