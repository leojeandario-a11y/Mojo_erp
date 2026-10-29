-- 001_core.sql : noyau (entités, devises, taux, directions, utilisateurs, RBAC, configuration, audit)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- Variables de session posées par l'API à chaque requête :
--   SET LOCAL app.user_id = '<uuid>';  SET LOCAL app.ip = '<ip>';
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- ===== Devises et taux (saisie manuelle) =====
CREATE TABLE currencies (
  code        char(3) PRIMARY KEY,
  name        text NOT NULL,
  symbol      text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE exchange_rates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_date     date NOT NULL,
  from_currency char(3) NOT NULL REFERENCES currencies(code),
  to_currency   char(3) NOT NULL REFERENCES currencies(code),
  rate          numeric(18,8) NOT NULL CHECK (rate > 0),
  entered_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rate_date, from_currency, to_currency),
  CHECK (from_currency <> to_currency)
);

-- ===== Entités financières (MoJoPIKtures, MOJO Store) =====
CREATE TABLE entities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  parent_id  uuid REFERENCES entities(id),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== Directions =====
CREATE TABLE departments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  color      text,
  head_user_id uuid,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== Utilisateurs =====
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  phone         text,
  department_id uuid REFERENCES departments(id),
  locale        text NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr','ht','en')),
  display_currency char(3) NOT NULL DEFAULT 'USD' REFERENCES currencies(code),
  is_active     boolean NOT NULL DEFAULT true,
  failed_logins int NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  last_login_at timestamptz,
  mfa_secret    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_users_upd BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE departments ADD FOREIGN KEY (head_user_id) REFERENCES users(id);
ALTER TABLE exchange_rates ADD FOREIGN KEY (entered_by) REFERENCES users(id);

CREATE TABLE user_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  ip_address  inet,
  user_agent  text,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== RBAC =====
CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,      -- ex: finance.transaction.create
  module      text NOT NULL,
  description text
);

CREATE TABLE role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  entity_id  uuid REFERENCES entities(id),   -- portée optionnelle
  granted_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

-- Contrôle d'accès côté base (utilisé par RLS)
CREATE OR REPLACE FUNCTION app_has_permission(perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN users u ON u.id = ur.user_id AND u.is_active
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = app_user_id()
      AND (p.code = perm OR p.code = '*')
  )
$$;

-- ===== Configuration (aucune valeur métier codée en dur) =====
CREATE TABLE app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ===== Documents (fichiers protégés, liaison polymorphe) =====
CREATE TABLE documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_table   text NOT NULL,
  owner_id      uuid NOT NULL,
  title         text NOT NULL,
  file_name     text NOT NULL,
  storage_path  text NOT NULL,
  mime_type     text,
  size_bytes    bigint,
  sha256        text,
  confidentiality text NOT NULL DEFAULT 'general' CHECK (confidentiality IN ('general','finance','hr','restricted')),
  uploaded_by   uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_documents_owner ON documents(owner_table, owner_id);

-- ===== Audit (append-only) =====
CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_id     uuid,
  ip_address  text,
  module      text,
  action      text NOT NULL,          -- INSERT / UPDATE / DELETE / LOGIN / APPROVE ...
  table_name  text,
  record_id   text,
  old_values  jsonb,
  new_values  jsonb,
  result      text NOT NULL DEFAULT 'success',
  message     text
);
CREATE INDEX idx_audit_table ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_user  ON audit_logs(user_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid text;
BEGIN
  IF TG_OP = 'DELETE' THEN rid := (to_jsonb(OLD)->>'id'); ELSE rid := (to_jsonb(NEW)->>'id'); END IF;
  INSERT INTO audit_logs(user_id, ip_address, module, action, table_name, record_id, old_values, new_values)
  VALUES (app_user_id(), NULLIF(current_setting('app.ip', true), ''), TG_ARGV[0], TG_OP, TG_TABLE_NAME, rid,
          CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) - 'password_hash' - 'mfa_secret' END,
          CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) - 'password_hash' - 'mfa_secret' END);
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION audit_immutable() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'audit_logs est en ajout seul (append-only)'; END $$;
CREATE TRIGGER trg_audit_no_change BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_immutable();

-- Helper : attache l'audit à une table
CREATE OR REPLACE PROCEDURE attach_audit(tbl regclass, module text) LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION audit_row(%L)', tbl, module);
END $$;

CALL attach_audit('users','auth');
CALL attach_audit('roles','auth');
CALL attach_audit('role_permissions','auth');
CALL attach_audit('user_roles','auth');
CALL attach_audit('app_settings','settings');
CALL attach_audit('exchange_rates','finance');
CALL attach_audit('departments','settings');
