#!/usr/bin/env bash
# Restore a backup made by backup.sh into the database in DATABASE_URL.
#
#   npm run db:restore -- ./backups/20261015T020000Z
#
# This REPLACES the data in that database. Stop the web app and worker first. Practise on a scratch
# database (point DATABASE_URL at it) before you ever need to do this for real.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${DATABASE_URL:?DATABASE_URL is not set}"
SRC="${1:?Usage: restore.sh <backup folder>}"
[ -f "$SRC/database.dump" ] || { echo "No database.dump in $SRC"; exit 1; }
( cd "$SRC" && sha256sum -c SHA256SUMS )

DBNAME="$(node -e 'console.log(new URL(process.env.DATABASE_URL).pathname.slice(1))')"
echo "This will REPLACE all data in database \"$DBNAME\" with the backup from $SRC."
read -r -p "Type the database name to continue: " CONFIRM
[ "$CONFIRM" = "$DBNAME" ] || { echo "Cancelled."; exit 1; }

pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --dbname="$DATABASE_URL" "$SRC/database.dump"

if [ -f "$SRC/storage.tar.gz" ] && [ "${STORAGE_DRIVER:-local}" = "local" ]; then
  DEST="${STORAGE_DIR:-./storage}"
  if [ -d "$DEST" ]; then mv "$DEST" "$DEST.before-restore.$(date +%s)"; fi
  mkdir -p "$DEST"
  tar -xzf "$SRC/storage.tar.gz" -C "$DEST"
fi
echo "Restore complete. Start the app and worker, then check the latest orders and stock."
