#!/usr/bin/env bash
# Deploy do backend na VPS de producao. Rodar via SSH a partir de /opt/amigofit:
#   ./scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> git pull"
git pull origin main

echo "==> build backend"
docker compose build backend

echo "==> restart backend"
docker compose up -d backend

echo "==> aguardando subir"
sleep 3

echo "==> logs"
docker logs --tail 20 amigofit-backend-1
