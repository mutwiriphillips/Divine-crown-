#!/usr/bin/env bash
# Back up the database and uploaded files.
#
#   npm run db:backup                 # writes to ./backups/<timestamp>/
#   BACKUP_DIR=/mnt/backups npm run db:backup
#
# Needs pg_dump (same major version as the server) and DATABASE_URL. With STORAGE_DRIVER=s3, files live in
# your buckets: turn on bucket versioning/replication there instead (this script then backs up the database only).
# Copy each backup OFF the server (another machine or cloud storage) and test a restore regularly.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${DATABASE_URL:?DATABASE_URL is not set}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_DIR:-./backups}/$STAMP"
mkdir -p "$DEST"
chmod 700 "$DEST"

echo "Dumping database..."
pg_dump --format=custom --no-owner --no-privileges --file="$DEST/database.dump" "$DATABASE_URL"

if [ "${STORAGE_DRIVER:-local}" = "local" ]; then
  SRC="${STORAGE_DIR:-./storage}"
  if [ -d "$SRC" ]; then
    echo "Archiving uploaded files from $SRC (excluding the resized-image cache)..."
    tar --exclude='./public/cache' -czf "$DEST/storage.tar.gz" -C "$SRC" .
  fi
fi

( cd "$DEST" && sha256sum * > SHA256SUMS )
echo "Backup written to $DEST"
# Keep the last N backups (default 14).
KEEP="${BACKUP_KEEP:-14}"
ls -1d "${BACKUP_DIR:-./backups}"/*/ 2>/dev/null | sort | head -n -"$KEEP" | xargs -r rm -rf
