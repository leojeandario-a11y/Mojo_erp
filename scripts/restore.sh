#!/usr/bin/env bash
# Restauration dans une base VIDE. Usage: DATABASE_URL=... ./scripts/restore.sh fichier.dump
set -euo pipefail
: "${DATABASE_URL:?}"; pg_restore --no-owner --exit-on-error -d "$DATABASE_URL" "${1:?fichier .dump requis}" && echo "Restauration terminée."
