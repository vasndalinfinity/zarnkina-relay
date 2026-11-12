#!/usr/bin/env bash
# Deploy the current main branch. Run from anywhere:
#   bash /opt/zarnkina-relay/deploy/update.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/zarnkina-relay}"
cd "$APP_DIR"

echo "==> fetching main"
git fetch origin main
git reset --hard origin/main

echo "==> rebuilding"
docker compose -f deploy/docker-compose.yml --project-directory deploy up -d --build

echo "==> pruning old images"
docker image prune -f >/dev/null

echo "==> health"
sleep 3
curl -sS http://127.0.0.1:8080/health || true
echo
