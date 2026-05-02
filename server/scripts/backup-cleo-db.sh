#!/usr/bin/env bash
#
# server/scripts/backup-cleo-db.sh
#
# Hourly cron-driven backup of the production cleo.db. Writes a snapshot to
# /var/backups/cleo/hourly/cleo-YYYY-MM-DD-HH.db using sqlite3's .backup
# command (WAL-aware; safe under writers). At 02:00 also copies into
# daily/, and on Sunday 02:00 also into weekly/. Then prunes per-tier
# retention. Updates /var/backups/cleo/last-success on every successful run.
#
# Env vars (defaults below for prod):
#   DB_PATH      Path to the live cleo.db (default: /home/cleo/cleo-broadcast/server/.broadcast-cache/cleo.db)
#   BACKUP_DIR   Local backup root (default: /var/backups/cleo)
#
# Idempotent: re-running for the same hour overwrites the same filename.
# Exit non-zero on any failure (cron logs it; sentinel file is NOT updated).

set -euo pipefail

DB_PATH="${DB_PATH:-/home/cleo/cleo-broadcast/server/.broadcast-cache/cleo.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cleo}"

if [ ! -f "$DB_PATH" ]; then
  echo "[backup-cleo-db] FATAL: DB_PATH not found: $DB_PATH" >&2
  exit 1
fi
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "[backup-cleo-db] FATAL: sqlite3 not installed" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR/hourly" "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"

now_hour=$(date +"%Y-%m-%d-%H")
now_date=$(date +"%Y-%m-%d")
now_week=$(date +"%Y-W%V")
hour_of_day=$(date +"%H")
day_of_week=$(date +"%u")  # 1=Mon … 7=Sun

hourly_path="$BACKUP_DIR/hourly/cleo-$now_hour.db"

echo "[backup-cleo-db] $(date -u +"%FT%TZ") snapshotting $DB_PATH -> $hourly_path"
sqlite3 "$DB_PATH" ".backup '$hourly_path'"

# Daily cascade — at 02:00 every day, copy into daily/.
if [ "$hour_of_day" = "02" ]; then
  daily_path="$BACKUP_DIR/daily/cleo-$now_date.db"
  cp "$hourly_path" "$daily_path"
  echo "[backup-cleo-db] daily cascade -> $daily_path"
fi

# Weekly cascade — at Sunday 02:00, copy into weekly/.
if [ "$hour_of_day" = "02" ] && [ "$day_of_week" = "7" ]; then
  weekly_path="$BACKUP_DIR/weekly/cleo-$now_week.db"
  cp "$hourly_path" "$weekly_path"
  echo "[backup-cleo-db] weekly cascade -> $weekly_path"
fi

# Per-tier local rotation. find -mtime +N matches files MORE than N days old.
find "$BACKUP_DIR/hourly" -name 'cleo-*.db' -type f -mtime +1 -delete
find "$BACKUP_DIR/daily" -name 'cleo-*.db' -type f -mtime +14 -delete
find "$BACKUP_DIR/weekly" -name 'cleo-*.db' -type f -mtime +84 -delete

# Sentinel file: every successful run updates the mtime. /admin/status reads
# this to compute "minutes since last backup."
touch "$BACKUP_DIR/last-success"

echo "[backup-cleo-db] done"
