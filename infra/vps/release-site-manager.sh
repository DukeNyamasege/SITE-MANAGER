#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run the Site Manager release installer as root." >&2
  exit 1
fi
if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <git-ref-or-commit>" >&2
  exit 1
fi

REF="$1"
REPO_URL="${SITE_MANAGER_REPO_URL:-https://github.com/DukeNyamasege/SITE-MANAGER.git}"
ROOT=/srv/site-manager
BUILD_ROOT="$ROOT/builds"
RELEASE_ROOT="$ROOT/manager/releases"
CURRENT="$ROOT/manager/current"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$BUILD_ROOT/site-manager-${STAMP}-$$"
PREVIOUS="$(readlink -f "$CURRENT" 2>/dev/null || true)"

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

for command in git npm node rsync curl systemctl runuser; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing prerequisite: $command" >&2; exit 1; }
done
[[ -r /etc/site-manager/database.env ]] || { echo "Run provision-postgres.sh first." >&2; exit 1; }
[[ -r /etc/site-manager/site-manager.env ]] || { echo "Run install-host.sh first." >&2; exit 1; }

mkdir -p "$WORK"
git -C "$WORK" init -q
git -C "$WORK" remote add origin "$REPO_URL"
git -C "$WORK" fetch -q --depth 1 origin "$REF"
git -C "$WORK" checkout -q --detach FETCH_HEAD
SHA="$(git -C "$WORK" rev-parse HEAD)"
SHORT="${SHA:0:12}"
RELEASE="$RELEASE_ROOT/${STAMP}-${SHORT}"

cd "$WORK"
npm ci --no-audit --no-fund
npm run build
npm prune --omit=dev --no-audit --no-fund

install -d -m 0750 -o root -g site-manager-runtime "$RELEASE"
rsync -a --delete --exclude='.git' "$WORK/" "$RELEASE/"
cat >"$RELEASE/site-manager-release.json" <<EOF
{
  "service": "site-manager",
  "source_sha": "${SHA}",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
chown -R root:site-manager-runtime "$RELEASE"
chmod -R g+rX,o-rwx "$RELEASE"

# Migrations execute from the candidate release before switching the service symlink.
# Current migrations are additive/backward-compatible; a migration failure aborts activation.
# shellcheck disable=SC1091
source /etc/site-manager/database.env
runuser -u site-manager -- env \
  NODE_ENV=production \
  DATABASE_URL="$DATABASE_URL" \
  DB_POOL_MAX="${DB_POOL_MAX:-10}" \
  DB_SSL="${DB_SSL:-false}" \
  node "$RELEASE/scripts/migrate.mjs"

NEXT="$ROOT/manager/.current-${SHORT}-$$"
ln -s "$RELEASE" "$NEXT"
mv -Tf "$NEXT" "$CURRENT"

rollback() {
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    local back="$ROOT/manager/.rollback-$$"
    ln -s "$PREVIOUS" "$back"
    mv -Tf "$back" "$CURRENT"
    systemctl restart site-manager.service || true
  fi
}

systemctl restart site-manager.service
healthy=0
for _ in {1..15}; do
  if curl -fsS --max-time 3 http://127.0.0.1:8787/api/v2/health >/dev/null; then
    healthy=1
    break
  fi
  sleep 1
done
if [[ "$healthy" -ne 1 ]]; then
  echo "Candidate Site Manager release failed its local health check; restoring the previous release." >&2
  rollback
  exit 1
fi

systemctl start site-manager-backup.timer
printf '%s\n' "$SHA" >"$ROOT/manager/current/.site-manager-source-sha"
echo "Site Manager release active: $RELEASE ($SHA)"
