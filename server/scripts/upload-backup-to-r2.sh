#!/usr/bin/env bash
#
# server/scripts/upload-backup-to-r2.sh
#
# Nightly off-box copy: for each retention tier (hourly/daily/weekly), pick
# the most recent local backup and aws-s3-cp it to R2 bucket
# $R2_BACKUP_BUCKET under matching prefix. Idempotent (overwrites existing
# objects with same key). R2 lifecycle rules on the bucket handle remote
# expiry — no client-side delete loop needed.
#
# Env vars (no defaults — must be set; cron sources them from the env file):
#   R2_BACKUP_ACCESS_KEY_ID
#   R2_BACKUP_SECRET_ACCESS_KEY
#   R2_BACKUP_BUCKET           e.g. cleo-broadcast-backups
#   R2_BACKUP_ENDPOINT         e.g. https://<account-id>.r2.cloudflarestorage.com
#   BACKUP_DIR (default /var/backups/cleo)
#
# Exit non-zero on any failure (cron logs it). Sentinel updated only on
# all-tiers-success.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/cleo}"

require() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "[upload-backup-to-r2] FATAL: env var $name is unset" >&2
    exit 1
  fi
}
require R2_BACKUP_ACCESS_KEY_ID
require R2_BACKUP_SECRET_ACCESS_KEY
require R2_BACKUP_BUCKET
require R2_BACKUP_ENDPOINT

if ! command -v aws >/dev/null 2>&1; then
  echo "[upload-backup-to-r2] FATAL: aws-cli not installed" >&2
  exit 1
fi

# aws-cli reads creds from these env vars when AWS_PROFILE is unset.
export AWS_ACCESS_KEY_ID="$R2_BACKUP_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_BACKUP_SECRET_ACCESS_KEY"
# R2 ignores region but aws-cli requires one.
export AWS_DEFAULT_REGION=auto

upload_latest() {
  local tier="$1"
  local src_dir="$BACKUP_DIR/$tier"
  if [ ! -d "$src_dir" ]; then
    echo "[upload-backup-to-r2] $tier: src dir missing, skipping ($src_dir)"
    return 0
  fi
  # Pick the lexically-greatest filename in the dir; our timestamps sort
  # correctly under YYYY-MM-DD-HH so this picks the most recent.
  local latest
  latest=$(ls -1 "$src_dir"/cleo-*.db 2>/dev/null | sort | tail -n 1)
  if [ -z "$latest" ]; then
    echo "[upload-backup-to-r2] $tier: no backups found in $src_dir, skipping"
    return 0
  fi
  local key="$tier/$(basename "$latest")"
  echo "[upload-backup-to-r2] $tier: uploading $latest -> s3://$R2_BACKUP_BUCKET/$key"
  # Run aws in a subshell so a failure is captured rather than aborting the
  # script immediately (set -e). We track failures and exit non-zero at the end
  # so all three tiers always run regardless of individual upload errors.
  aws s3 cp "$latest" "s3://$R2_BACKUP_BUCKET/$key" \
    --endpoint-url "$R2_BACKUP_ENDPOINT" \
    --no-progress \
    || { echo "[upload-backup-to-r2] $tier: upload FAILED" >&2; return 1; }
}

failed=0
upload_latest hourly || failed=1
upload_latest daily  || failed=1
upload_latest weekly || failed=1

if [ "$failed" -eq 1 ]; then
  echo "[upload-backup-to-r2] one or more tiers failed — not updating sentinel" >&2
  exit 1
fi

# Reuse the same sentinel as the local backup script — operator only cares
# that *some* backup activity ran successfully recently. If finer-grained
# observability is needed later, split into last-local-success vs
# last-r2-success.
touch "$BACKUP_DIR/last-success"

echo "[upload-backup-to-r2] done"
