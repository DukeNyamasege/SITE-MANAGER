#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then echo "Run rollback as root." >&2; exit 1; fi
if [[ $# -ne 1 ]]; then echo "Usage: NNN_ROLLBACK_CONFIRMED=YES $0 <release-directory-name>" >&2; exit 1; fi
if [[ "${NNN_ROLLBACK_CONFIRMED:-NO}" != "YES" ]]; then
  echo "Set NNN_ROLLBACK_CONFIRMED=YES to confirm an intentional production runtime rollback." >&2
  exit 1
fi
NAME="$1"
[[ "$NAME" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Invalid release name." >&2; exit 1; }
ROOT=/srv/site-manager/nnn
TARGET="$ROOT/releases/$NAME"
CURRENT="$ROOT/current"
[[ -d "$TARGET" ]] || { echo "Release not found: $TARGET" >&2; exit 1; }
[[ -f "$TARGET/site-manager-runtime.json" ]] || { echo "Target is not a Site Manager-compatible nnn release." >&2; exit 1; }
PREVIOUS="$(readlink -f "$CURRENT" 2>/dev/null || true)"
PREVIOUS_ENV="$(cat /etc/site-manager/runtime.env 2>/dev/null || true)"
SHA="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(!p.source_sha)process.exit(1);process.stdout.write(p.source_sha)' "$TARGET/site-manager-release.json")"

NEXT="$ROOT/.rollback-switch-$$"
ln -s "$TARGET" "$NEXT"
mv -Tf "$NEXT" "$CURRENT"
TMP="/etc/site-manager/runtime.env.$$"
printf 'NNN_RUNTIME_RELEASE=%s\n' "$SHA" >"$TMP"
chown root:site-manager "$TMP"
chmod 0640 "$TMP"
mv -f "$TMP" /etc/site-manager/runtime.env

if ! systemctl restart site-manager.service; then
  echo "Site Manager failed after nnn rollback; restoring previous nnn release." >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    BACK="$ROOT/.rollback-restore-$$"
    ln -s "$PREVIOUS" "$BACK"
    mv -Tf "$BACK" "$CURRENT"
  fi
  if [[ -n "$PREVIOUS_ENV" ]]; then
    printf '%s\n' "$PREVIOUS_ENV" >/etc/site-manager/runtime.env
    chown root:site-manager /etc/site-manager/runtime.env
    chmod 0640 /etc/site-manager/runtime.env
  fi
  systemctl restart site-manager.service || true
  exit 1
fi

echo "Shared nnn runtime rolled back to $TARGET ($SHA)"
