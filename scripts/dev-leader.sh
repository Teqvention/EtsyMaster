#!/usr/bin/env bash
# Runs the dev server that leads the background work (batch jobs, healing,
# the sync) and starts it again whenever it stops by itself: 13/14 Oct the
# servers were killed overnight under memory pressure, and an order's last
# 28 images waited until someone started one in the morning.
#
#   PORT=3000 nohup bash scripts/dev-leader.sh >> <log> 2>&1 &
#   kill <its pid>                 # stops the server too, for good
#
# After a stop it didn't ask for, Turbopack's cache can send every page into
# a reload loop, so .next/dev is moved aside (the last two kept, as
# .next/dev-broken-auto-*) before the next start. While it runs, a Mac on
# its charger doesn't go to sleep (caffeinate -s; AWAKE=0 leaves that out):
# batch jobs are only brought in while a server is up.
set -u
cd "$(dirname "$0")/.."

PORT=${PORT:-3000}
AWAKE=${AWAKE:-1}
set -m # the server in its own process group, so stopping it reaches next too
server=
stopping=
quick=0

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

stop() {
  stopping=1
  [ -n "$server" ] && kill -TERM -- "-$server" 2>/dev/null
  [ -n "$server" ] && wait "$server" 2>/dev/null
  log "Stopped"
  exit 0
}
trap stop INT TERM

if [ "$AWAKE" = 1 ] && command -v caffeinate >/dev/null; then
  caffeinate -s -w $$ &
fi

while :; do
  started=$(date +%s)
  PORT=$PORT pnpm dev --port "$PORT" &
  server=$!
  log "Server started on port $PORT (pid $server)"
  wait "$server"
  code=$?
  [ -n "$stopping" ] && exit 0
  server=
  log "Server stopped by itself (exit $code): starting again"
  if [ -d .next/dev ]; then
    mv .next/dev ".next/dev-broken-auto-$(date '+%Y%m%d-%H%M%S')"
    ls -d .next/dev-broken-auto-* 2>/dev/null | sort -r | tail -n +3 | while read -r old; do rm -rf "$old"; done
  fi
  # One that keeps dying at once (a broken commit, the port taken) is tried less often.
  if [ $(($(date +%s) - started)) -lt 60 ]; then quick=$((quick + 1)); else quick=0; fi
  if [ "$quick" -ge 5 ]; then
    log "It stopped within a minute five times in a row: waiting 5 minutes"
    sleep 300
    quick=0
  else
    sleep 10
  fi
done
