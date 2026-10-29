-- A role can be assigned to the same user in multiple entity scopes.
ALTER TABLE user_roles DROP CONSTRAINT user_roles_pkey;
ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_user_role_entity_key
  UNIQUE NULLS NOT DISTINCT (user_id, role_id, entity_id);

CREATE OR REPLACE FUNCTION app_has_permission(perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN users u ON u.id = ur.user_id AND u.is_active
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = app_user_id()
      AND ur.entity_id IS NULL
      AND (p.code = perm OR p.code = '*')
  )
$$;

CREATE OR REPLACE FUNCTION app_has_entity_permission(perm text, entity uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN users u ON u.id = ur.user_id AND u.is_active
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = app_user_id()
      AND (ur.entity_id IS NULL OR ur.entity_id = entity)
      AND (p.code = perm OR p.code = '*')
  )
$$;

GRANT EXECUTE ON FUNCTION app_has_entity_permission(text, uuid) TO mojo_app;

CREATE OR REPLACE FUNCTION log_auth_event(event_action text, event_result text, event_message text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF event_action NOT IN ('LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'ADMIN_PASSWORD_RESET_LINK')
     OR event_result NOT IN ('success', 'denied') THEN
    RAISE EXCEPTION 'Événement d’authentification invalide';
  END IF;

  INSERT INTO audit_logs(user_id, ip_address, module, action, result, message)
  VALUES (app_user_id(), NULLIF(current_setting('app.ip', true), ''), 'auth', event_action, event_result, event_message);
END;
$$;
