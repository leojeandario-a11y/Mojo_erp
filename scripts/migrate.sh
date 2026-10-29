#!/usr/bin/env bash
# Applique les migrations SQL dans l'ordre. Usage: DATABASE_URL=postgres://... ./scripts/migrate.sh
set -euo pipefail
if [ -z "${DATABASE_URL:-}" ] && [ -z "${PGHOST:-}" ]; then
  echo "DATABASE_URL ou PGHOST requis (compte propriétaire/admin de la base)" >&2
  exit 1
fi
psql_cmd() {
  if [ -n "${DATABASE_URL:-}" ]; then
    psql "$DATABASE_URL" "$@"
  else
    psql "$@"
  fi
}
cd "$(dirname "$0")/../db/migrations"
psql_cmd -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS schema_migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())"
for f in $(ls *.sql | sort); do
  if [ "$(psql_cmd -tAc "SELECT 1 FROM schema_migrations WHERE filename='$f'")" = "1" ]; then
    echo "déjà appliquée: $f"; continue
  fi
  echo "application: $f"
  psql_cmd -v ON_ERROR_STOP=1 --single-transaction -f "$f"
  psql_cmd -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations(filename) VALUES ('$f')"
done
if [ -n "${APP_DB_PASSWORD:-}" ]; then
  psql_cmd -v ON_ERROR_STOP=1 -v app_pw="$APP_DB_PASSWORD" <<'SQL'
ALTER ROLE mojo_app PASSWORD :'app_pw';
SQL
fi
echo "Migrations terminées."
