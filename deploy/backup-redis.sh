#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Off-box Redis snapshot. OPTIONAL — not a launch blocker.
#
#   ./deploy/backup-redis.sh [destination-dir]     (default: ./backups)
#
# Worst case without any backup is that every EXTRA-mode user re-approves an
# Aster agent: one wallet signature each, no funds at risk (agents are
# registered canWithdraw: false). That is an annoyance, not an incident.
#
# READ THIS BEFORE RESTORING ONE.
# A restore is NOT automatically the right move. The dump contains
# aster:tpsl-watch, the pending TP/SL protections for resting limit orders.
# Restoring a stale dump re-arms watches whose orders have long since filled or
# been cancelled, against positions that may no longer exist. Agent keys
# (aster:agent-key:*, no expiry) age fine; sessions (sess:*) expire in 12h on
# their own. If you restore, consider clearing the watch hash afterwards:
#
#     docker compose exec redis redis-cli DEL aster:tpsl-watch
#
# And the thing that actually makes any of this recoverable is NOT this script:
# it is AGENT_KEY_ENCRYPTION_SECRET from .env. Every agent key in the dump is
# encrypted with it. Without that secret this file is unrecoverable ciphertext.
# Keep .env in a password manager, off this machine.
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

DEST=${1:-./backups}
mkdir -p "$DEST"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$DEST/redis-$STAMP.rdb"

echo "==> Asking Redis for a fresh snapshot"
# BGSAVE returns immediately; poll rdb_bgsave_in_progress rather than guessing
# at a sleep, otherwise a large dump gets copied mid-write.
docker compose exec -T redis redis-cli BGSAVE

for _ in $(seq 1 60); do
  if docker compose exec -T redis redis-cli INFO persistence \
     | tr -d '\r' | grep -q '^rdb_bgsave_in_progress:0'; then
    break
  fi
  sleep 1
done

echo "==> Copying dump.rdb out of the container"
docker compose cp redis:/data/dump.rdb "$OUT"

echo "==> Wrote $OUT ($(du -h "$OUT" | cut -f1))"
echo
echo "This file is only half a backup. The other half is AGENT_KEY_ENCRYPTION_SECRET"
echo "from .env — without it the agent keys in here cannot be decrypted."
echo "Copy this off the VPS; keeping it beside the thing it protects is not a backup."
