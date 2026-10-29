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
      AND (p.code = perm OR (p.code = '*' AND ur.entity_id IS NULL))
  )
$$;

CREATE OR REPLACE FUNCTION prevent_scoped_super_admin() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.entity_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM roles WHERE id = NEW.role_id AND code = 'super_admin') THEN
    RAISE EXCEPTION 'Super Administrator cannot be assigned to a single entity';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_super_admin_global_scope
  BEFORE INSERT OR UPDATE OF role_id, entity_id ON user_roles
  FOR EACH ROW EXECUTE FUNCTION prevent_scoped_super_admin();
