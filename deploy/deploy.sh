#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# RDO ONE deploy / rollback.
#
#   ./deploy/deploy.sh              pull, build, tag, start, verify
#   ./deploy/deploy.sh --no-pull    build what is in the working tree
#   ./deploy/deploy.sh rollback     go back to the previously deployed tag
#   ./deploy/deploy.sh status       what is running, and on which tag
#   ./deploy/deploy.sh logs [svc]   follow logs
#   ./deploy/deploy.sh stop         stop containers, keep data
#
# Deliberately absent: any wrapper around `docker compose down -v`. That flag
# deletes the redis_data volume — every user's encrypted Aster agent key and
# every pending TP/SL watch — and it is by far the most likely way this data
# actually gets lost. `stop` below does what people reach for `down -v` to do.
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

HISTORY_FILE=".deploy-history"

die() { echo "ERROR: $*" >&2; exit 1; }

[ -f .env ] || die ".env not found. Copy .env.example to .env and fill it in."

# Health gate shared by deploy and rollback.
wait_for_health() {
  local name=$1 tries=${2:-30} state
  printf '    %-9s ' "$name"
  for _ in $(seq 1 "$tries"); do
    state=$(docker compose ps --format json "$name" 2>/dev/null \
      | sed -n 's/.*"Health":"\([a-z]*\)".*/\1/p' | head -1)
    case "$state" in
      healthy) echo "healthy"; return 0 ;;
      unhealthy) echo "UNHEALTHY"; return 1 ;;
    esac
    printf '.'
    sleep 2
  done
  echo " timed out (last state: ${state:-unknown})"
  return 1
}

cmd_deploy() {
  local pull=1
  [ "${1:-}" = "--no-pull" ] && pull=0

  if [ "$pull" = 1 ]; then
    echo "==> Pulling latest code"
    git pull --ff-only
  fi

  local tag previous
  tag=$(git rev-parse --short HEAD)
  previous=$(tail -n 1 "$HISTORY_FILE" 2>/dev/null | awk '{print $1}' || true)

  echo "==> Building images at tag $tag"
  # IMAGE_TAG is exported rather than written into .env so the file stays
  # purely secrets + config, and so a half-finished deploy cannot leave .env
  # naming an image that was never built.
  #
  # The frontend build bakes NEXT_PUBLIC_* from .env into the browser bundle,
  # which is why a config change to either of those needs this build step and
  # not merely a restart.
  IMAGE_TAG="$tag" docker compose build

  echo "==> Starting services"
  IMAGE_TAG="$tag" docker compose up -d --remove-orphans

  # nginx resolves `backend` and `frontend` to IPs ONCE, when it loads its
  # config. Recreating either container hands it a new IP that nginx does not
  # know about, and every request 502s until something makes it re-resolve.
  # This reload is that something — without it a deploy can appear to succeed
  # and serve nothing but 502s.
  echo "==> Reloading nginx (re-resolves upstream container IPs)"
  docker compose exec -T nginx nginx -s reload || echo "    (nginx not running yet — skipped)"

  echo "==> Waiting for health"
  local ok=1
  wait_for_health redis    || ok=0
  wait_for_health backend  || ok=0
  wait_for_health frontend || ok=0

  if [ "$ok" = 1 ]; then
    # Recorded only on success, so `rollback` can never target a tag that never
    # came up healthy.
    printf '%s %s\n' "$tag" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$HISTORY_FILE"
    echo
    echo "Deployed $tag."
    [ -n "$previous" ] && echo "Rollback target if needed: $previous"
  else
    echo
    echo "DEPLOY UNHEALTHY at $tag." >&2
    echo "  Backend reports unhealthy whenever Redis is down — check that first:" >&2
    echo "    docker compose logs --tail=50 redis backend" >&2
    [ -n "$previous" ] && echo "  Roll back with: ./deploy/deploy.sh rollback   (→ $previous)" >&2
    exit 1
  fi
}

cmd_rollback() {
  local target
  # Second-to-last entry: the last one is the deploy currently running.
  target=$(tail -n 2 "$HISTORY_FILE" 2>/dev/null | head -n 1 | awk '{print $1}' || true)
  [ -n "$target" ] || die "No previous deployment recorded in $HISTORY_FILE."

  docker image inspect "rdo-one/backend:$target" >/dev/null 2>&1 \
    || die "Image rdo-one/backend:$target is gone (pruned?). Check out that commit and deploy it with --no-pull."

  echo "==> Rolling back to $target"
  # No build: the whole point is to run the exact images that were running
  # before, not to rebuild them from source that may have moved on.
  IMAGE_TAG="$target" docker compose up -d --remove-orphans
  docker compose exec -T nginx nginx -s reload || true

  wait_for_health backend  || true
  wait_for_health frontend || true
  printf '%s %s (rollback)\n' "$target" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$HISTORY_FILE"
  echo "Rolled back to $target."
}

cmd_status() {
  docker compose ps
  echo
  echo "Deploy history (newest last):"
  tail -n 10 "$HISTORY_FILE" 2>/dev/null || echo "  none recorded"
}

cmd_stop() {
  # `stop`, not `down`. Containers stop; volumes, networks and the redis_data
  # volume are all untouched.
  echo "==> Stopping containers (data volumes untouched)"
  docker compose stop
}

case "${1:-deploy}" in
  deploy)   shift || true; cmd_deploy "${1:-}" ;;
  --no-pull) cmd_deploy --no-pull ;;
  rollback) cmd_rollback ;;
  status)   cmd_status ;;
  stop)     cmd_stop ;;
  logs)     shift || true; docker compose logs -f --tail=100 "$@" ;;
  *)        die "Unknown command: $1  (deploy | rollback | status | stop | logs)" ;;
esac
