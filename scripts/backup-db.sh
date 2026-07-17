#!/usr/bin/env bash
# Backup diario do Postgres de producao. Agendado via cron na VPS, retem 14 dias.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups"
RETENTION_DAYS=14
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

set -a
source "$PROJECT_DIR/.env"
set +a

docker exec -e PGPASSWORD="$DB_PASSWORD" amigofit-db-1 \
  pg_dump -U amigofit -d amigofit \
  | gzip > "$BACKUP_DIR/amigofit_${TIMESTAMP}.sql.gz"

find "$BACKUP_DIR" -name 'amigofit_*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete

echo "Backup salvo: $BACKUP_DIR/amigofit_${TIMESTAMP}.sql.gz"
