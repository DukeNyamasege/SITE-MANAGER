#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then echo "Run edge activation as root." >&2; exit 1; fi
if [[ "${EDGE_CUTOVER_APPROVED:-NO}" != "YES" ]]; then
  echo "Refusing to activate public Caddy routes. Set EDGE_CUTOVER_APPROVED=YES only during an intentional staging/production cutover." >&2
  exit 1
fi

for file in /etc/site-manager/host.env /srv/site-manager/nnn/current/site-manager-runtime.json; do
  [[ -r "$file" ]] || { echo "Missing required file: $file" >&2; exit 1; }
done
[[ -e /srv/site-manager/manager/current/server/index.js ]] || { echo "No active Site Manager release is installed." >&2; exit 1; }

# shellcheck disable=SC1091
source /etc/site-manager/host.env

curl -fsS --max-time 3 http://127.0.0.1:8787/api/v2/health >/dev/null || {
  echo "Site Manager local health check failed." >&2
  exit 1
}
node - /srv/site-manager/nnn/current/site-manager-runtime.json <<'NODE'
const fs = require('node:fs');
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (p.runtime !== 'nnn' || Number(p.contract_version) !== 2 || p.deployment_model !== 'shared-static-runtime') {
  throw new Error('Installed nnn release does not satisfy Site Manager contract v2.');
}
NODE

caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# Restart rather than reload so group membership and filesystem permissions are guaranteed.
systemctl restart caddy

check_https() {
  local url="$1" mode="$2"
  for _ in {1..20}; do
    if [[ "$mode" == "json" ]]; then
      if curl -fsS --max-time 5 "$url" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const p=JSON.parse(d);if(p.runtime!=="nnn"||Number(p.contract_version)!==2)process.exit(1)})'; then return 0; fi
    else
      if curl -fsS --max-time 5 "$url" >/dev/null; then return 0; fi
    fi
    sleep 2
  done
  return 1
}

check_https "https://${SITE_MANAGER_DOMAIN}/api/v2/health" plain || {
  echo "Public Site Manager HTTPS health check failed." >&2
  exit 1
}
check_https "https://${NNN_PREVIEW_DOMAIN}/site-manager-runtime.json" json || {
  echo "Public nnn preview-host contract check failed." >&2
  exit 1
}

echo "Caddy edge active: manager=${SITE_MANAGER_DOMAIN}, preview=${NNN_PREVIEW_DOMAIN}."
echo "Customer publishing mode was not changed."
