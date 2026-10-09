#!/usr/bin/env bash
# Runs the app with `pnpm start` and keeps it on the latest commit from GitHub:
# every INTERVAL seconds it fetches origin/BRANCH and, when there is something
# new, fast-forwards, reinstalls, rebuilds and restarts the server. Open tabs
# notice the new build and reload themselves (src/components/update-reloader.tsx).
#
#   pnpm serve                    # or: INTERVAL=30 PORT=3000 bash scripts/autoupdate.sh
#
# Local edits (e.g. mockups saved in data/) are never discarded: if a pull
# would overwrite them, the update is skipped and logged. A commit that fails
# to build is rolled back and skipped until a newer one arrives.
set -u
cd "$(dirname "$0")/.."

INTERVAL=${INTERVAL:-60}
BRANCH=${BRANCH:-main}
PORT=${PORT:-3000}
set -m # run the server in its own process group so stop() reaches next too
server=
bad=

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

build() { pnpm install --frozen-lockfile && pnpm build; }

start() {
  PORT=$PORT pnpm start &
  server=$!
  log "Server running on http://localhost:$PORT ($(git rev-parse --short HEAD))"
}

stop() {
  [ -n "$server" ] || return 0
  kill -TERM -- "-$server" 2>/dev/null
  wait "$server" 2>/dev/null
  server=
}

trap 'stop; exit 0' INT TERM

build || { log "Build failed — fix it and run again"; exit 1; }
start

while sleep "$INTERVAL"; do
  git fetch --quiet origin "$BRANCH" || { log "Fetch failed (offline?)"; continue; }
  remote=$(git rev-parse FETCH_HEAD)
  # Nothing new, or a commit we already know doesn't build.
  git merge-base --is-ancestor "$remote" HEAD && continue
  [ "$remote" = "$bad" ] && continue

  previous=$(git rev-parse HEAD)
  if ! git merge --ff-only --quiet "$remote"; then
    log "Can't fast-forward to ${remote:0:7} (local changes in the way?) — skipping"
    continue
  fi

  log "Updating ${previous:0:7} → ${remote:0:7}"
  stop
  if ! build; then
    log "Build of ${remote:0:7} failed — rolling back to ${previous:0:7}"
    bad=$remote
    git reset --quiet --keep "$previous"
    build || { log "Rollback build failed too — giving up"; exit 1; }
  fi
  start
done
