#!/usr/bin/env bash
# Backup diario do Postgres E dos arquivos enviados (videos de exercicio,
# imagens do chat). Agendado via cron na VPS, retem 14 dias localmente.
# Se BACKUP_REMOTE estiver definido no .env (destino rclone, ex.:
# b2:amigofit-backups), envia uma copia para fora da VPS — backup que so
# existe no mesmo servidor nao protege contra perda do servidor.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups"
RETENTION_DAYS=14
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

set -a
source "$PROJECT_DIR/.env"
set +a

DB_FILE="$BACKUP_DIR/amigofit_${TIMESTAMP}.sql.gz"
UPLOADS_FILE="$BACKUP_DIR/amigofit_uploads_${TIMESTAMP}.tar.gz"

docker exec -e PGPASSWORD="$DB_PASSWORD" amigofit-db-1 \
  pg_dump -U amigofit -d amigofit \
  | gzip > "$DB_FILE"
# Confere que o dump nao esta vazio/corrompido.
gzip -t "$DB_FILE"
[ "$(gzip -dc "$DB_FILE" | head -c 1000 | wc -c)" -gt 0 ]

# Arquivos enviados ficam no volume Docker "uploads" do backend.
docker run --rm -v amigofit_uploads:/uploads:ro -v "$BACKUP_DIR":/backup alpine \
  tar czf "/backup/$(basename "$UPLOADS_FILE")" -C /uploads .
gzip -t "$UPLOADS_FILE"

find "$BACKUP_DIR" -name 'amigofit_*.gz' -mtime "+${RETENTION_DAYS}" -delete

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rclone copy "$DB_FILE" "$BACKUP_REMOTE/"
  rclone copy "$UPLOADS_FILE" "$BACKUP_REMOTE/"
  echo "Copia externa enviada para $BACKUP_REMOTE"
else
  echo "AVISO: BACKUP_REMOTE nao definido — backup so existe nesta VPS." >&2
fi

echo "Backup salvo: $DB_FILE e $UPLOADS_FILE"
