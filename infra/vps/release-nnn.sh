#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run the nnn release installer as root." >&2
  exit 1
fi
if [[ $# -ne 1 ]]; then
  echo "Usage: NNN_CUTOVER_APPROVED=YES bash $0 <approved-git-ref-or-commit>" >&2
  exit 1
fi
if [[ "${NNN_CUTOVER_APPROVED:-NO}" != "YES" ]]; then
  echo "Refusing to activate nnn. Set NNN_CUTOVER_APPROVED=YES only after explicit final production-cutover approval." >&2
  exit 1
fi

REF="$1"
REPO_URL="${NNN_REPO_URL:-https://github.com/DukeNyamasege/nnn.git}"
ROOT=/srv/site-manager
BUILD_ROOT="$ROOT/builds"
RELEASE_ROOT="$ROOT/nnn/releases"
CURRENT="$ROOT/nnn/current"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$BUILD_ROOT/nnn-${STAMP}-$$"
PREVIOUS="$(readlink -f "$CURRENT" 2>/dev/null || true)"
PREVIOUS_RUNTIME_ENV="$(cat /etc/site-manager/runtime.env 2>/dev/null || true)"

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

for command in git npm node rsync systemctl; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing prerequisite: $command" >&2; exit 1; }
done
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
npm run generate:brand-css
npm run build

CONTRACT="$WORK/dist/site-manager-runtime.json"
[[ -f "$CONTRACT" ]] || { echo "nnn build is missing dist/site-manager-runtime.json." >&2; exit 1; }
node - "$CONTRACT" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
if (payload.runtime !== 'nnn' || Number(payload.contract_version) !== 2 || payload.deployment_model !== 'shared-static-runtime') {
  throw new Error('nnn release does not satisfy Site Manager publishing contract v2.');
}
NODE

install -d -m 0750 -o root -g site-manager-runtime "$RELEASE"
rsync -a --delete "$WORK/dist/" "$RELEASE/"
cat >"$RELEASE/site-manager-release.json" <<EOF
{
  "runtime": "nnn",
  "source_sha": "${SHA}",
  "contract_version": 2,
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
chown -R root:site-manager-runtime "$RELEASE"
chmod -R g+rX,o-rwx "$RELEASE"

NEXT="$ROOT/nnn/.current-${SHORT}-$$"
ln -s "$RELEASE" "$NEXT"
mv -Tf "$NEXT" "$CURRENT"

write_runtime_env() {
  local release_sha="$1"
  local tmp="/etc/site-manager/runtime.env.$$"
  cat >"$tmp" <<EOF
NNN_RUNTIME_RELEASE=${release_sha}
EOF
  chown root:site-manager "$tmp"
  chmod 0640 "$tmp"
  mv -f "$tmp" /etc/site-manager/runtime.env
}
write_runtime_env "$SHA"

rollback() {
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    local back="$ROOT/nnn/.rollback-$$"
    ln -s "$PREVIOUS" "$back"
    mv -Tf "$back" "$CURRENT"
  else
    rm -f "$CURRENT"
  fi
  if [[ -n "$PREVIOUS_RUNTIME_ENV" ]]; then
    printf '%s\n' "$PREVIOUS_RUNTIME_ENV" >/etc/site-manager/runtime.env
  else
    printf 'NNN_RUNTIME_RELEASE=nnn-main-unpinned\n' >/etc/site-manager/runtime.env
  fi
  chown root:site-manager /etc/site-manager/runtime.env
  chmod 0640 /etc/site-manager/runtime.env
  systemctl restart site-manager.service || true
}

if systemctl is-enabled site-manager.service >/dev/null 2>&1; then
  if ! systemctl restart site-manager.service; then
    echo "Site Manager failed after nnn release switch; rolling nnn back." >&2
    rollback
    exit 1
  fi
fi

# Optional HTTPS verification of the dedicated preview host. It is deliberately opt-in
# because DNS/SSL may be staged separately from release installation.
if [[ "${VERIFY_NNN_PREVIEW_HTTPS:-NO}" == "YES" ]]; then
  # shellcheck disable=SC1091
  source /etc/site-manager/host.env
  healthy=0
  for _ in {1..15}; do
    if curl -fsS --max-time 5 "https://${NNN_PREVIEW_DOMAIN}/site-manager-runtime.json" \
      | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const p=JSON.parse(d);if(p.runtime!=="nnn"||Number(p.contract_version)!==2)process.exit(1)})'; then
      healthy=1
      break
    fi
    sleep 2
  done
  if [[ "$healthy" -ne 1 ]]; then
    echo "The preview hostname did not serve the expected nnn contract; rolling back." >&2
    rollback
    exit 1
  fi
fi

echo "Shared nnn release active: $RELEASE ($SHA)"
echo "VPS_PUBLISH_MODE is unchanged; customer publishing is still controlled separately."
