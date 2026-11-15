#!/usr/bin/env bash
# LEGO STOCK MARKET — one-command install/update of the sync worker on an Ubuntu server.
#   First install:   curl -fsSL https://raw.githubusercontent.com/Math77-gogo/lego-stock-market/main/deploy/install-worker.sh | sudo bash
#   Update:          same command again
#   Change secrets:  sudo bash /opt/lego-stock-market/deploy/install-worker.sh --reconfigure
set -euo pipefail
REPO=https://github.com/Math77-gogo/lego-stock-market.git
DIR=/opt/lego-stock-market
ENV_FILE=/etc/lsm-worker.env

echo "==> Installing Docker and git"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker.io docker-compose-v2 git curl openssl >/dev/null
systemctl enable --now docker >/dev/null

echo "==> Getting the code"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull -q; else git clone -q "$REPO" "$DIR"; fi

if [ ! -f "$ENV_FILE" ] || [ "${1:-}" = "--reconfigure" ]; then
  echo
  echo "==> Secrets (typed here, stored only on this server in $ENV_FILE)"
  read -rp  "Supabase connection string (Session pooler, starts with postgresql://): " DBURL </dev/tty
  read -rsp "BrickLink Consumer Key: " CK </dev/tty; echo
  read -rsp "BrickLink Consumer Secret: " CS </dev/tty; echo
  read -rsp "BrickLink Token Value: " TV </dev/tty; echo
  read -rsp "BrickLink Token Secret: " TS </dev/tty; echo
  SECRET=$(grep -s '^WORKER_API_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)
  [ -n "$SECRET" ] || SECRET=$(openssl rand -hex 32)
  umask 077
  cat > "$ENV_FILE" <<CONF
APP_MODE=production
DATABASE_URL=$DBURL
BRICKLINK_CONSUMER_KEY=$CK
BRICKLINK_CONSUMER_SECRET=$CS
BRICKLINK_TOKEN_VALUE=$TV
BRICKLINK_TOKEN_SECRET=$TS
WORKER_API_SECRET=$SECRET
WORKER_PORT=8080
CONF
  chmod 600 "$ENV_FILE"
fi

IP=$(curl -fsS https://api.ipify.org)
export WORKER_HOST="${IP//./-}.sslip.io"

echo "==> Building and starting (first time takes a few minutes)"
cd "$DIR/deploy"
docker compose up -d --build

echo "==> Waiting for the worker"
for i in $(seq 1 30); do
  if curl -fsS "https://$WORKER_HOST/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 5
done

SECRET=$(grep '^WORKER_API_SECRET=' "$ENV_FILE" | cut -d= -f2-)
echo
echo "================================================================"
if [ "${OK:-}" = 1 ]; then echo " Worker is running."; else echo " Worker started; HTTPS may need another minute. Logs: docker compose -f $DIR/deploy/docker-compose.yml logs -f"; fi
echo
echo " Server IP (register this in BrickLink):  $IP"
echo " WORKER_INTERNAL_URL:                     https://$WORKER_HOST"
echo " WORKER_API_SECRET (for the web app, keep private):"
echo "   $SECRET"
echo "================================================================"
