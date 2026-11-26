#!/usr/bin/env bash
# Set up Ticksmith on a Cloud VM (Ubuntu/Debian or any Linux with Node 22+).
#
#   bash deploy/vm/setup.sh                    # check, install deps, test, build, live-check upstream
#   sudo -E bash deploy/vm/setup.sh --install-service
#                                              # ...and install + start the systemd service,
#                                              # then verify the running server end to end
#
# Safe to re-run after `git pull` (it rebuilds and restarts the service).
# Never writes secrets: the API needs none.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALL_SERVICE=0
for arg in "$@"; do
  case "$arg" in
    --install-service) INSTALL_SERVICE=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

cd "$APP_DIR"

log "Checking Node.js (needs 22 or newer)"
command -v node >/dev/null || fail "node not found. Install Node 22 LTS, e.g. https://nodejs.org/en/download (or: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || fail "node $(node -v) is too old; install Node 22+"
command -v npm >/dev/null || fail "npm not found"
echo "node $(node -v), npm $(npm -v)"

log "Checking that this VM can reach the official Hyperliquid API"
node -e '
fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "exchangeStatus" }), signal: AbortSignal.timeout(10000) })
  .then(async (r) => { const t = await r.text(); if (!r.ok) throw new Error("HTTP " + r.status + " " + t.slice(0, 200)); console.log("api.hyperliquid.xyz reachable:", t.slice(0, 120)); })
  .catch((e) => { console.error("Cannot reach api.hyperliquid.xyz:", e.cause?.message ?? e.message); console.error("Open outbound HTTPS (443) to api.hyperliquid.xyz in the VM firewall / egress rules."); process.exit(1); });
'

log "Installing dependencies (npm ci)"
npm ci --no-audit --no-fund

log "Running unit tests and the build (npm test)"
npm test

if [ "$INSTALL_SERVICE" -eq 0 ]; then
  log "Done. Start it in the foreground with:  HOST=127.0.0.1 PORT=4173 npm start"
  echo "Then verify end to end:                npm run verify:live -- http://127.0.0.1:4173"
  echo "To run it as a service:                sudo -E bash deploy/vm/setup.sh --install-service"
  exit 0
fi

[ "$(id -u)" -eq 0 ] || fail "--install-service needs root (run with sudo -E)"
command -v systemctl >/dev/null || fail "systemctl not found; run 'npm start' under your own process manager instead"

RUN_USER="${SUDO_USER:-}"
[ -n "$RUN_USER" ] && [ "$RUN_USER" != "root" ] || fail "run via sudo from the account that should own the service (not as root directly)"
NODE_BIN="$(command -v node)"

log "Installing /etc/ticksmith/ticksmith.env (kept if it already exists)"
install -d -m 0755 /etc/ticksmith
if [ ! -f /etc/ticksmith/ticksmith.env ]; then
  install -m 0644 deploy/vm/ticksmith.env.example /etc/ticksmith/ticksmith.env
  echo "created /etc/ticksmith/ticksmith.env from the example — review it"
else
  echo "keeping existing /etc/ticksmith/ticksmith.env"
fi

log "Installing the systemd unit (user=$RUN_USER, dir=$APP_DIR, node=$NODE_BIN)"
sed -e "s#__APP_DIR__#$APP_DIR#g" -e "s#__USER__#$RUN_USER#g" -e "s#__NODE__#$NODE_BIN#g" \
  deploy/vm/ticksmith.service > /etc/systemd/system/ticksmith.service
chown -R "$RUN_USER" "$APP_DIR/dist" "$APP_DIR/node_modules"
systemctl daemon-reload
systemctl enable ticksmith.service >/dev/null
systemctl restart ticksmith.service

# shellcheck disable=SC1091
PORT="$(. /etc/ticksmith/ticksmith.env; echo "${PORT:-4173}")"
log "Waiting for the service on 127.0.0.1:$PORT"
for _ in $(seq 1 30); do
  if node -e "fetch('http://127.0.0.1:$PORT/v1/endpoints').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; then break; fi
  sleep 1
done
systemctl --no-pager --lines=5 status ticksmith.service || true

log "End-to-end check against the running service (real Hyperliquid data)"
sudo -u "$RUN_USER" node tools/verify-live.mjs "http://127.0.0.1:$PORT"

log "Done. Logs: journalctl -u ticksmith -f    Put Caddy/nginx in front: deploy/vm/Caddyfile.example"
