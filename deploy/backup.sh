#!/usr/bin/env bash
# LEGO STOCK MARKET — nightly database backup (runs on the worker server via cron).
# Dumps the public (app data) and auth (accounts) schemas from Supabase into
# /var/backups/lsm, keeps the last 14 days. Restore: see docs/DEPLOYMENT.md.
set -euo pipefail
ENV_FILE=/etc/lsm-worker.env
DEST=/var/backups/lsm
KEEP_DAYS=14

DATABASE_URL=$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
[ -n "$DATABASE_URL" ] || { echo "$(date -u +%FT%TZ) ERROR no DATABASE_URL"; exit 1; }

mkdir -p "$DEST"
chmod 700 "$DEST"
FILE="$DEST/lsm-$(date -u +%Y-%m-%d_%H%M).dump"

# pg_dump from the official Postgres image; a newer pg_dump can dump older servers.
if docker run --rm --network host -e PGURL="$DATABASE_URL" postgres:18-alpine \
    sh -c 'pg_dump "$PGURL" --format=custom --no-owner --no-privileges --schema=public --schema=auth' \
    > "$FILE.tmp"; then
  mv "$FILE.tmp" "$FILE"
  chmod 600 "$FILE"
  echo "$(date -u +%FT%TZ) OK $(basename "$FILE") $(du -h "$FILE" | cut -f1)"
else
  rm -f "$FILE.tmp"
  echo "$(date -u +%FT%TZ) ERROR backup failed"
  exit 1
fi

find "$DEST" -name 'lsm-*.dump' -mtime +"$KEEP_DAYS" -delete
