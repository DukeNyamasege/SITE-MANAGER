#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then echo "Run publish-mode changes as root." >&2; exit 1; fi
if [[ $# -ne 1 || ( "$1" != "plan" && "$1" != "apply" ) ]]; then
  echo "Usage: $0 plan|apply" >&2
  exit 1
fi
MODE="$1"
if [[ "$MODE" == "apply" && "${CUSTOMER_PUBLISH_APPROVED:-NO}" != "YES" ]]; then
  echo "Refusing to enable customer publishing. Set CUSTOMER_PUBLISH_APPROVED=YES only after staging/cutover approval." >&2
  exit 1
fi
ENV_FILE=/etc/site-manager/site-manager.env
[[ -r "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }

TMP="${ENV_FILE}.$$"
awk -v mode="$MODE" '
  BEGIN { done=0 }
  /^VPS_PUBLISH_MODE=/ { print "VPS_PUBLISH_MODE=" mode; done=1; next }
  { print }
  END { if (!done) print "VPS_PUBLISH_MODE=" mode }
' "$ENV_FILE" >"$TMP"
chown root:site-manager "$TMP"
chmod 0640 "$TMP"
mv -f "$TMP" "$ENV_FILE"

systemctl restart site-manager.service
curl -fsS --max-time 3 http://127.0.0.1:8787/api/v2/health >/dev/null

echo "Site Manager customer publishing mode is now: $MODE"
