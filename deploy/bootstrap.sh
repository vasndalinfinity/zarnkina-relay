#!/usr/bin/env bash
# One-time server setup. Ubuntu 22.04/24.04, run as root or with sudo.
#   bash deploy/bootstrap.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/zarnkina-relay}"
REPO="${REPO:-https://github.com/vasndalinfinity/zarnkina-relay.git}"

if ! command -v docker >/dev/null 2>&1; then
  echo "==> installing docker"
  curl -fsSL https://get.docker.com | sh
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose plugin missing" >&2
  exit 1
fi

if [ ! -d "$APP_DIR/.git" ]; then
  echo "==> cloning into $APP_DIR"
  mkdir -p "$APP_DIR"
  git clone "$REPO" "$APP_DIR"
fi

cd "$APP_DIR"

if [ ! -f deploy/.env ]; then
  echo "==> deploy/.env missing; copy deploy/.env.example and fill it" >&2
  exit 1
fi

# Nobody but root reads the secrets file.
chmod 600 deploy/.env

echo "==> building and starting"
docker compose -f deploy/docker-compose.yml --project-directory deploy up -d --build

echo "==> waiting for health"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/health >/dev/null 2>&1; then
    echo "healthy"
    curl -sS http://127.0.0.1:8080/health
    echo
    exit 0
  fi
  sleep 2
done

echo "not healthy after 60s; run: docker compose -f deploy/docker-compose.yml logs -f relay" >&2
exit 1
