CREATE OR REPLACE FUNCTION log_auth_event(event_action text, event_result text, event_message text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF event_action NOT IN (
       'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'ADMIN_PASSWORD_RESET_LINK',
       'PASSWORD_RESET_REQUEST', 'PASSWORD_RESET'
     )
     OR event_result NOT IN ('success', 'denied') THEN
    RAISE EXCEPTION 'Événement d’authentification invalide';
  END IF;

  INSERT INTO audit_logs(user_id, ip_address, module, action, result, message)
  VALUES (app_user_id(), NULLIF(current_setting('app.ip', true), ''), 'auth', event_action, event_result, event_message);
END;
$$;
