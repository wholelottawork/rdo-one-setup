#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Restore-test a Redis dump. An untested backup is not a backup.
#
#   ./deploy/verify-backup.sh [dump.rdb]      (default: newest in ./backups)
#
# What it proves, in order of how much it is worth:
#
#   1. the file is a dump Redis will actually LOAD (a truncated copy, a file
#      grabbed mid-BGSAVE, or a corrupted transfer fails here)
#   2. it contains data (DBSIZE > 0)
#   3. an agent key inside it DECRYPTS with the AGENT_KEY_ENCRYPTION_SECRET
#      currently in .env
#
# (3) is the point of the whole exercise. The dump is ciphertext: every agent
# key in it is AES-256-GCM under that one secret. A perfect dump plus the wrong
# secret is an unrecoverable file that looks exactly like a working backup
# until the day you need it. This is the only check that tells them apart.
#
# Nothing here touches the live stack: the dump is loaded into a THROWAWAY
# container on no network, with its own volume, and removed at the end.
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

DUMP=${1:-}
if [ -z "$DUMP" ]; then
  # Newest .rdb in ./backups. `ls -t` rather than find -newer: the names are
  # timestamped by backup-redis.sh, so this is stable and readable.
  DUMP=$(ls -t ./backups/*.rdb 2>/dev/null | head -1 || true)
fi

if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "No dump to verify."
  echo
  echo "Take one with:  ./deploy/backup-redis.sh"
  echo "Then verify it: ./deploy/verify-backup.sh [path/to/dump.rdb]"
  echo
  echo "If you have never run backup-redis.sh, you do not have backups —"
  echo "do not let deploy/RUNBOOK.md or anything else claim that you do."
  exit 1
fi

DUMP_ABS=$(cd "$(dirname "$DUMP")" && pwd)/$(basename "$DUMP")
echo "==> Verifying $DUMP_ABS ($(du -h "$DUMP_ABS" | cut -f1))"

# The secret is read from .env and never printed, never passed on a command
# line (where it would sit in `ps` output for every user on the box) — it goes
# in as an env var to a node process that only ever reports pass/fail.
if [ ! -f .env ]; then
  echo "!! .env not found — cannot check that the dump decrypts."
  exit 1
fi
# shellcheck disable=SC1091
SECRET=$(grep -E '^AGENT_KEY_ENCRYPTION_SECRET=' .env | head -1 | cut -d= -f2- || true)
if [ -z "$SECRET" ]; then
  echo "!! AGENT_KEY_ENCRYPTION_SECRET is empty in .env."
  echo "   Every agent key in this dump is ciphertext under that value."
  echo "   Without it the dump is unrecoverable — this is not a warning, it is"
  echo "   the failure mode the whole check exists to catch."
  exit 1
fi

CONTAINER=rdo-verify-redis-$$
VOLUME=rdo-verify-data-$$

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Starting a throwaway Redis (no network, own volume)"
docker volume create "$VOLUME" >/dev/null
# --network none: this container must not be able to reach the live stack, and
# nothing needs to reach it — every command below goes through `docker exec`.
docker run -d --name "$CONTAINER" --network none \
  -v "$VOLUME":/data \
  redis:7-alpine redis-server --save '' --appendonly no >/dev/null

# Copy the dump in, then restart so Redis loads it at boot. Copying into a
# RUNNING Redis does nothing: it has already read /data, and would overwrite
# the file on its next save.
docker cp "$DUMP_ABS" "$CONTAINER":/data/dump.rdb
docker restart "$CONTAINER" >/dev/null

echo "==> Waiting for it to load the dump"
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" redis-cli ping 2>/dev/null | grep -q PONG; then
    break
  fi
  sleep 1
done

if ! docker exec "$CONTAINER" redis-cli ping 2>/dev/null | grep -q PONG; then
  echo "!! FAIL — Redis never came up with this dump. It is corrupt or truncated."
  docker logs "$CONTAINER" 2>&1 | tail -20
  exit 1
fi

DBSIZE=$(docker exec "$CONTAINER" redis-cli DBSIZE | tr -d '\r')
echo "==> Loaded. DBSIZE = $DBSIZE"
if [ "$DBSIZE" = "0" ]; then
  echo "!! FAIL — the dump loaded but is EMPTY. A backup of nothing is not a backup."
  exit 1
fi

# One agent key is enough: they all share the one secret, so if one decrypts
# they all do, and if one does not, none do.
KEY=$(docker exec "$CONTAINER" redis-cli --scan --pattern 'aster:agent-key:*' --count 1 2>/dev/null | head -1 | tr -d '\r')

if [ -z "$KEY" ]; then
  echo
  echo "== PARTIAL PASS =="
  echo "The dump loads and holds $DBSIZE keys, but contains no aster:agent-key:*"
  echo "entry, so the DECRYPTION half could not be tested."
  echo
  echo "That is the expected result before the first EXTRA-mode user exists."
  echo "It is NOT a verified backup: the thing most likely to be wrong — whether"
  echo "AGENT_KEY_ENCRYPTION_SECRET still matches the ciphertext — is exactly"
  echo "what went unchecked. Re-run this once a real user has approved an agent."
  exit 0
fi

echo "==> Found $KEY — testing that it decrypts with the current secret"
PAYLOAD=$(docker exec "$CONTAINER" redis-cli --no-raw GET "$KEY" | tr -d '\r' | sed 's/^"//; s/"$//')

# The decryption is done HERE, not in the container: the throwaway Redis must
# never be handed the encryption secret. Same algorithm as
# backend/src/lib/secret-box.ts — deliberately re-implemented in a few lines so
# this script has no dependency on the app being installed or running.
if AGENT_KEY_PAYLOAD="$PAYLOAD" AGENT_KEY_SECRET="$SECRET" node -e '
  const crypto = require("node:crypto");
  const payload = process.env.AGENT_KEY_PAYLOAD || "";
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    console.error("stored value is not iv:tag:ciphertext — wrong key, or a format change");
    process.exit(1);
  }
  const key = crypto.createHash("sha256").update(process.env.AGENT_KEY_SECRET).digest();
  let plain;
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    d.setAuthTag(Buffer.from(tagHex, "hex"));
    plain = Buffer.concat([d.update(Buffer.from(dataHex, "hex")), d.final()]).toString("utf8");
  } catch {
    // A wrong secret fails GCM authentication, which throws. Caught rather
    // than left to crash: the stack trace is noise, and the shell prints the
    // explanation that actually helps.
    console.error("GCM authentication failed — the secret does not match this ciphertext");
    process.exit(1);
  }
  // GCM already authenticated it; this only confirms it is the shape we expect
  // (a 32-byte hex private key) rather than something that merely decrypted.
  if (!/^0x[0-9a-f]{64}$/i.test(plain)) {
    console.error("decrypted, but the result is not an agent private key");
    process.exit(1);
  }
  // NEVER print the plaintext. The whole point is that it stays secret.
'; then
  echo
  echo "== PASS =="
  echo "$DUMP_ABS restores, holds $DBSIZE keys, and its agent keys decrypt with"
  echo "the AGENT_KEY_ENCRYPTION_SECRET currently in .env."
else
  echo
  echo "!! FAIL — the dump loads, but its agent keys DO NOT decrypt."
  echo
  echo "The dump and the secret in .env do not belong together. Either the"
  echo "secret was rotated after this dump was taken, or .env is not the one"
  echo "that was live. Find the matching secret before you need it: restoring"
  echo "this dump as-is logs every EXTRA-mode user out of their agent, and no"
  echo "amount of the dump can bring it back."
  exit 1
fi
