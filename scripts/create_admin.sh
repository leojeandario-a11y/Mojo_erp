#!/usr/bin/env bash
# Crée le premier Super Administrator. Utilise DATABASE_URL ou les variables PG* standard.
# Le mot de passe est demandé (non affiché) et haché en bcrypt par PostgreSQL (pgcrypto), compatible avec bcrypt côté Node.
set -euo pipefail
: "${DATABASE_URL:-${PGHOST:-}}"
if [ -z "${DATABASE_URL:-}" ] && [ -z "${PGDATABASE:-}" ]; then
  echo "DATABASE_URL ou PGHOST/PGDATABASE requis" >&2
  exit 1
fi
EMAIL="${1:?email requis}"; NAME="${2:?nom requis}"
read -rsp "Mot de passe (12 caractères minimum) : " PW; echo
[ "${#PW}" -ge 12 ] || { echo "Mot de passe trop court"; exit 1; }
psql_cmd() {
  if [ -n "${DATABASE_URL:-}" ]; then
    psql "$DATABASE_URL" "$@"
  else
    psql "$@"
  fi
}
psql_cmd -v ON_ERROR_STOP=1 -v email="$EMAIL" -v name="$NAME" -v pw="$PW" <<'SQL'
WITH u AS (
  INSERT INTO users(email, password_hash, full_name, department_id)
  VALUES (:'email', crypt(:'pw', gen_salt('bf', 12)), :'name', (SELECT id FROM departments WHERE code='DG'))
  RETURNING id)
INSERT INTO user_roles(user_id, role_id) SELECT u.id, r.id FROM u, roles r WHERE r.code='super_admin';
SQL
echo "Super Administrator créé : $EMAIL"
