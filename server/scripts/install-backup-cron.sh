#!/usr/bin/env bash
#
# server/scripts/install-backup-cron.sh
#
# One-shot installer for the Phase 4.5 cleo.db backup cron. Run once on
# the VPS as root (or via sudo) after Cloudflare R2 ops are complete and
# .env has R2_BACKUP_* set. Idempotent: re-running replaces the cron
# entry with the same content.
#
# Side effects:
#   - Creates /var/backups/cleo/{hourly,daily,weekly}, owned by cleo:cleo
#   - Writes /etc/cron.d/cleo-backup
#   - Verifies cron is enabled

set -euo pipefail

if [ "$(id -u)" != "0" ]; then
  echo "[install-backup-cron] FATAL: must run as root (sudo bash $0)" >&2
  exit 1
fi

REPO_ROOT="${REPO_ROOT:-/home/cleo/cleo-broadcast}"
ENV_FILE="$REPO_ROOT/server/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "[install-backup-cron] FATAL: $ENV_FILE not found — populate R2_BACKUP_* keys before installing cron" >&2
  exit 1
fi

if ! grep -q "^R2_BACKUP_ACCESS_KEY_ID=" "$ENV_FILE"; then
  echo "[install-backup-cron] FATAL: R2_BACKUP_ACCESS_KEY_ID missing from $ENV_FILE" >&2
  exit 1
fi

# Create the local backup tree, owned by cleo so the cron job can write.
mkdir -p /var/backups/cleo/hourly /var/backups/cleo/daily /var/backups/cleo/weekly
chown -R cleo:cleo /var/backups/cleo
chmod -R 750 /var/backups/cleo

# Write /etc/cron.d/cleo-backup. SHELL + PATH stanzas first so the cron
# environment matches what an interactive `cleo` shell sees. Source .env
# inline so R2_* vars reach the upload script.
cat > /etc/cron.d/cleo-backup <<EOF
# Phase 4.5 cleo.db backups — installed by server/scripts/install-backup-cron.sh
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Local snapshot every hour at :00. Tier cascade (daily at 02:00, weekly Sun 02:00) lives in the script.
0 * * * * cleo bash -c 'set -a; . $ENV_FILE; set +a; $REPO_ROOT/server/scripts/backup-cleo-db.sh' >> /var/log/cleo-backup.log 2>&1

# Off-box upload to R2 every night at 04:00.
0 4 * * * cleo bash -c 'set -a; . $ENV_FILE; set +a; $REPO_ROOT/server/scripts/upload-backup-to-r2.sh' >> /var/log/cleo-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/cleo-backup

# Reload cron so the new file is picked up. cron-file drops in /etc/cron.d
# are usually reread on the next minute boundary, but kicking it now means
# the operator can verify with `systemctl status cron`.
if command -v systemctl >/dev/null 2>&1; then
  systemctl reload cron 2>/dev/null || systemctl restart cron
fi

# Make sure the log file exists with the right ownership so the cron output
# doesn't fail with EPERM on first write.
touch /var/log/cleo-backup.log
chown cleo:cleo /var/log/cleo-backup.log

# Spot-check: do the scripts exist and are they executable?
for s in backup-cleo-db.sh upload-backup-to-r2.sh; do
  if [ ! -x "$REPO_ROOT/server/scripts/$s" ]; then
    echo "[install-backup-cron] WARNING: $REPO_ROOT/server/scripts/$s is not executable" >&2
    chmod +x "$REPO_ROOT/server/scripts/$s" || true
  fi
done

echo "[install-backup-cron] done. cron entries installed:"
cat /etc/cron.d/cleo-backup
echo
echo "[install-backup-cron] next steps:"
echo "  1. Run a single backup NOW to seed: sudo -u cleo bash -c 'set -a; . $ENV_FILE; set +a; $REPO_ROOT/server/scripts/backup-cleo-db.sh'"
echo "  2. Tail the log: tail -f /var/log/cleo-backup.log"
echo "  3. After 04:00 the next morning, verify R2 has the upload."
