#!/usr/bin/env bash
#
# server/scripts/restore-drill.sh
#
# Manual restore drill for cleo.db. Downloads the latest R2 backup from
# the daily/ tier, runs PRAGMA integrity_check, runs a representative
# SELECT against broadcasts and enrichment, prints PASS or FAIL.
#
# Run before deleting the .bak JSON fallbacks per server/DEPLOY.md.
#
# Env vars (same as upload-backup-to-r2.sh):
#   R2_BACKUP_ACCESS_KEY_ID
#   R2_BACKUP_SECRET_ACCESS_KEY
#   R2_BACKUP_BUCKET
#   R2_BACKUP_ENDPOINT
#
# Exits 0 on PASS, 1 on FAIL.

set -euo pipefail

require() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "[restore-drill] FATAL: env var $name is unset" >&2
    exit 1
  fi
}
require R2_BACKUP_ACCESS_KEY_ID
require R2_BACKUP_SECRET_ACCESS_KEY
require R2_BACKUP_BUCKET
require R2_BACKUP_ENDPOINT

for cmd in aws sqlite3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[restore-drill] FATAL: $cmd not installed" >&2
    exit 1
  fi
done

export AWS_ACCESS_KEY_ID="$R2_BACKUP_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_BACKUP_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

echo "[restore-drill] listing daily/ in s3://$R2_BACKUP_BUCKET"
latest_key=$(aws s3 ls "s3://$R2_BACKUP_BUCKET/daily/" \
    --endpoint-url "$R2_BACKUP_ENDPOINT" \
  | awk '{print $4}' | grep '\.db$' | sort | tail -n 1)

if [ -z "$latest_key" ]; then
  echo "[restore-drill] FAIL: no daily/ backups in bucket"
  exit 1
fi

echo "[restore-drill] downloading daily/$latest_key"
aws s3 cp "s3://$R2_BACKUP_BUCKET/daily/$latest_key" "$scratch/restored.db" \
  --endpoint-url "$R2_BACKUP_ENDPOINT" \
  --no-progress

echo "[restore-drill] running PRAGMA integrity_check"
integrity=$(sqlite3 "$scratch/restored.db" "PRAGMA integrity_check;")
if [ "$integrity" != "ok" ]; then
  echo "[restore-drill] FAIL: integrity_check returned: $integrity"
  exit 1
fi
echo "[restore-drill] integrity_check: ok"

echo "[restore-drill] sampling broadcasts table"
broadcast_count=$(sqlite3 "$scratch/restored.db" "SELECT COUNT(*) FROM broadcasts;")
echo "[restore-drill] broadcasts row count: $broadcast_count"

echo "[restore-drill] sampling enrichment table"
enrichment_count=$(sqlite3 "$scratch/restored.db" "SELECT COUNT(*) FROM enrichment;")
echo "[restore-drill] enrichment row count: $enrichment_count"

# Spot-check: the schema must include the migration's app_events table
events_check=$(sqlite3 "$scratch/restored.db" \
  "SELECT name FROM sqlite_master WHERE type='table' AND name='app_events';")
if [ "$events_check" != "app_events" ]; then
  echo "[restore-drill] FAIL: app_events table missing from restored backup"
  exit 1
fi
echo "[restore-drill] app_events table present"

echo "[restore-drill] PASS"
exit 0
