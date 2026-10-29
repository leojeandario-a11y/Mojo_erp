#!/usr/bin/env bash
# Sauvegarde manuelle. Usage: DATABASE_URL=... ./scripts/backup.sh [dossier]
set -euo pipefail
: "${DATABASE_URL:?}"; DIR="${1:-./backups}"; mkdir -p "$DIR"
F="$DIR/mojo_$(date +%F_%H%M).dump"
pg_dump "$DATABASE_URL" -Fc > "$F" && echo "Sauvegarde: $F"
