#!/usr/bin/env bash
# Testa se o backup mais recente restaura de verdade, sem tocar em producao:
# sobe um Postgres descartavel, restaura o dump, confere as tabelas e
# confere se o tar dos arquivos abre. Rodar na VPS: ./scripts/test-restore.sh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups"
DB_FILE=$(ls -t "$BACKUP_DIR"/amigofit_2*.sql.gz | head -1)
UPLOADS_FILE=$(ls -t "$BACKUP_DIR"/amigofit_uploads_*.tar.gz 2>/dev/null | head -1 || true)
NAME=amigofit-restore-test

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> restaurando $DB_FILE num Postgres temporario"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=teste -e POSTGRES_USER=amigofit -e POSTGRES_DB=amigofit postgres:16-alpine >/dev/null
for i in $(seq 1 30); do
  docker exec "$NAME" pg_isready -U amigofit >/dev/null 2>&1 && break
  sleep 1
done
gzip -dc "$DB_FILE" | docker exec -i "$NAME" psql -q -v ON_ERROR_STOP=1 -U amigofit -d amigofit >/dev/null

for table in users profiles messages extracted_data meals meal_checkins workout_plans workout_checkins schema_migrations; do
  count=$(docker exec "$NAME" psql -tA -U amigofit -d amigofit -c "SELECT count(*) FROM $table")
  echo "  $table: $count linhas"
done

if [ -n "$UPLOADS_FILE" ]; then
  echo "==> conferindo $UPLOADS_FILE"
  echo "  $(tar tzf "$UPLOADS_FILE" | grep -vc '/$') arquivo(s) no backup de uploads"
fi

echo "OK: restauracao testada com sucesso"
