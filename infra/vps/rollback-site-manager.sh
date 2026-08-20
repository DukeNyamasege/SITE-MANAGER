#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then echo "Run rollback as root." >&2; exit 1; fi
if [[ $# -ne 1 ]]; then echo "Usage: $0 <release-directory-name>" >&2; exit 1; fi
NAME="$1"
[[ "$NAME" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Invalid release name." >&2; exit 1; }
ROOT=/srv/site-manager/manager
TARGET="$ROOT/releases/$NAME"
CURRENT="$ROOT/current"
[[ -d "$TARGET" ]] || { echo "Release not found: $TARGET" >&2; exit 1; }
PREVIOUS="$(readlink -f "$CURRENT" 2>/dev/null || true)"
[[ "$TARGET" != "$PREVIOUS" ]] || { echo "That Site Manager release is already active."; exit 0; }

NEXT="$ROOT/.rollback-switch-$$"
ln -s "$TARGET" "$NEXT"
mv -Tf "$NEXT" "$CURRENT"
systemctl restart site-manager.service

healthy=0
for _ in {1..15}; do
  if curl -fsS --max-time 3 http://127.0.0.1:8787/api/v2/health >/dev/null; then healthy=1; break; fi
  sleep 1
done
if [[ "$healthy" -ne 1 ]]; then
  echo "Rollback target failed health check; restoring the prior Site Manager release." >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    BACK="$ROOT/.rollback-restore-$$"
    ln -s "$PREVIOUS" "$BACK"
    mv -Tf "$BACK" "$CURRENT"
    systemctl restart site-manager.service || true
  fi
  exit 1
fi

echo "Site Manager rolled back to $TARGET"
