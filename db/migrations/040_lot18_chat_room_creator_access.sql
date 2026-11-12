BEGIN;

DROP POLICY IF EXISTS collaboration_chat_rooms_read ON collaboration_chat_rooms;
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

COMMIT;
