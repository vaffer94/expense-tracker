#!/usr/bin/env bash
# Weekly snapshot of the database onto the Pi's SD card.
#
# Copies the whole SQLite file, so it knows nothing about the schema and keeps working
# unchanged as the app evolves. Restore instructions are in the README.
set -euo pipefail

cd "$(dirname "$0")/.."

DEST="${BACKUP_DIR:-backups}"
KEEP="${BACKUP_KEEP:-8}"
TMP="/app/data/.backup-tmp.db"
OUT="$DEST/expenses-$(date +%Y-%m-%d).db"

mkdir -p "$DEST"

# SQLite's own backup API rather than a plain file copy: it takes a consistent snapshot even if
# a write lands mid-copy. sqlite3 is in the standard library, so the image needs nothing extra.
docker compose exec -T app python -c "
import sqlite3
src = sqlite3.connect('/app/data/expenses.db')
dst = sqlite3.connect('$TMP')
with dst:
    src.backup(dst)
dst.close()
src.close()
"

docker compose cp "app:$TMP" "$OUT"
docker compose exec -T app rm -f "$TMP"
echo "$(date '+%F %T')  saved $OUT ($(du -h "$OUT" | cut -f1))"

# Keep the newest $KEEP snapshots, drop the rest.
ls -1t "$DEST"/expenses-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -- "$old"
  echo "$(date '+%F %T')  pruned $old"
done
