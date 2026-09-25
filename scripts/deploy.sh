#!/usr/bin/env bash
# Deploy do backend na VPS de producao. Rodar via SSH a partir de /opt/amigofit:
#   ./scripts/deploy.sh
# Faz backup antes, sobe a versao nova e so da o deploy por concluido quando
# /health responde de verdade (banco incluido). Se nao responder, mostra os
# logs e sai com erro.
set -euo pipefail

cd "$(dirname "$0")/.."

set -a
source .env
set +a
if [ -z "${AI_KEYS_SECRET:-}" ] || [ "${#AI_KEYS_SECRET}" -lt 32 ]; then
  echo "ERRO: AI_KEYS_SECRET ausente ou curto demais no .env (minimo 32 caracteres)." >&2
  exit 1
fi

echo "==> backup antes do deploy (migracoes de banco podem rodar)"
./scripts/backup-db.sh

echo "==> git pull"
for attempt in 1 2 3; do
  git pull origin main && break
  echo "git pull falhou (tentativa $attempt), tentando de novo em 5s..."
  sleep 5
  [ "$attempt" = 3 ] && exit 1
done

echo "==> build backend"
docker compose build backend

echo "==> restart backend"
docker compose up -d backend

echo "==> aguardando /health"
for i in $(seq 1 30); do
  if docker exec amigofit-backend-1 wget -qO- http://localhost:3001/health 2>/dev/null | grep -q '"ok":true'; then
    echo "OK: backend saudavel apos ${i}x2s"
    docker logs --tail 15 amigofit-backend-1
    exit 0
  fi
  sleep 2
done

echo "ERRO: backend nao ficou saudavel em 60s. Logs:" >&2
docker logs --tail 60 amigofit-backend-1 >&2
exit 1
