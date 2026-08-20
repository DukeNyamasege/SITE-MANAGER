#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run the host installer as root." >&2
  exit 1
fi

SITE_MANAGER_DOMAIN="${SITE_MANAGER_DOMAIN:-}"
NNN_PREVIEW_DOMAIN="${NNN_PREVIEW_DOMAIN:-}"
PLATFORM_SITE_BASE_DOMAIN="${PLATFORM_SITE_BASE_DOMAIN:-}"
CADDY_EMAIL="${CADDY_EMAIL:-}"
CADDY_APPLY="${CADDY_APPLY:-NO}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

valid_host() {
  local value="$1"
  [[ ${#value} -le 253 ]] || return 1
  [[ "$value" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]]
}
for pair in "SITE_MANAGER_DOMAIN:$SITE_MANAGER_DOMAIN" "NNN_PREVIEW_DOMAIN:$NNN_PREVIEW_DOMAIN" "PLATFORM_SITE_BASE_DOMAIN:$PLATFORM_SITE_BASE_DOMAIN"; do
  key="${pair%%:*}"; value="${pair#*:}"
  if [[ -z "$value" ]] || ! valid_host "$value"; then
    echo "$key must be a valid public hostname." >&2
    exit 1
  fi
done
if [[ -z "$CADDY_EMAIL" || "$CADDY_EMAIL" != *@* ]]; then
  echo "CADDY_EMAIL is required for certificate notifications." >&2
  exit 1
fi

for command in node npm git rsync caddy systemctl; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing prerequisite: $command" >&2; exit 1; }
done
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "$node_major" -ne 22 && "$node_major" -ne 24 ]]; then
  echo "Node.js 22 or 24 is required; found $(node --version)." >&2
  exit 1
fi

getent group site-manager-runtime >/dev/null || groupadd --system site-manager-runtime
if ! id site-manager >/dev/null 2>&1; then
  useradd --system --home-dir /srv/site-manager --shell /usr/sbin/nologin --user-group site-manager
fi
usermod -a -G site-manager-runtime site-manager
if id caddy >/dev/null 2>&1; then usermod -a -G site-manager-runtime caddy; fi

install -d -m 0755 -o root -g root /srv/site-manager
install -d -m 0750 -o root -g site-manager-runtime \
  /srv/site-manager/manager /srv/site-manager/manager/releases \
  /srv/site-manager/nnn /srv/site-manager/nnn/releases \
  /srv/site-manager/builds
install -d -m 0750 -o site-manager -g site-manager \
  /srv/site-manager/data /srv/site-manager/data/uploads \
  /srv/site-manager/data/deployments /srv/site-manager/data/backups
install -d -m 0750 -o root -g site-manager /etc/site-manager
install -d -m 2770 -o root -g site-manager-runtime /etc/caddy/sites

# Ensure the Caddy import glob is valid even before the first customer hostname exists.
if [[ ! -e /etc/caddy/sites/00-placeholder.caddy ]]; then
  printf '# Site Manager customer routes are generated here.\n' >/etc/caddy/sites/00-placeholder.caddy
fi
chown root:site-manager-runtime /etc/caddy/sites/00-placeholder.caddy
chmod 0640 /etc/caddy/sites/00-placeholder.caddy

escape_sed() { printf '%s' "$1" | sed 's/[&|\\]/\\&/g'; }
manager_escaped="$(escape_sed "$SITE_MANAGER_DOMAIN")"
preview_escaped="$(escape_sed "$NNN_PREVIEW_DOMAIN")"
email_escaped="$(escape_sed "$CADDY_EMAIL")"
sed \
  -e "s|__SITE_MANAGER_DOMAIN__|${manager_escaped}|g" \
  -e "s|__NNN_PREVIEW_DOMAIN__|${preview_escaped}|g" \
  -e "s|__CADDY_EMAIL__|${email_escaped}|g" \
  "$SCRIPT_DIR/Caddyfile.template" >/etc/caddy/Caddyfile
chown root:root /etc/caddy/Caddyfile
chmod 0644 /etc/caddy/Caddyfile

if [[ ! -f /etc/site-manager/site-manager.env ]]; then
  cat >/etc/site-manager/site-manager.env <<EOF
APP_URL=https://${SITE_MANAGER_DOMAIN}
PORT=8787
NODE_ENV=production
AUTH_SESSION_TTL_DAYS=30
AUTH_DEV_RETURN_LINKS=false
NNN_PREVIEW_URL=https://${NNN_PREVIEW_DOMAIN}
PREVIEW_TTL_MINUTES=60
SITE_UPLOAD_DIR=/srv/site-manager/data/uploads
PLATFORM_SITE_BASE_DOMAIN=${PLATFORM_SITE_BASE_DOMAIN}
VPS_PUBLIC_IPV4=
VPS_PUBLIC_IPV6=
VPS_CNAME_TARGET=
VPS_PUBLISH_MODE=plan
VPS_DEPLOYMENT_STATE_DIR=/srv/site-manager/data/deployments
NNN_SHARED_DIST_DIR=/srv/site-manager/nnn/current
CADDY_ROUTE_DIR=/etc/caddy/sites
CADDY_BIN=/usr/bin/caddy
CADDYFILE=/etc/caddy/Caddyfile
SITE_MANAGER_API_UPSTREAM=http://127.0.0.1:8787
VPS_HEALTHCHECK_ATTEMPTS=4
VPS_HEALTHCHECK_DELAY_MS=1000
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM="Site Manager <no-reply@${SITE_MANAGER_DOMAIN}>"
DOMAIN_VERIFICATION_SECRET=
EOF
fi
chown root:site-manager /etc/site-manager/site-manager.env
chmod 0640 /etc/site-manager/site-manager.env

if [[ ! -f /etc/site-manager/runtime.env ]]; then
  cat >/etc/site-manager/runtime.env <<'EOF'
# Updated atomically by release-nnn.sh after an approved nnn release is installed.
NNN_RUNTIME_RELEASE=nnn-main-unpinned
EOF
fi
chown root:site-manager /etc/site-manager/runtime.env
chmod 0640 /etc/site-manager/runtime.env

cat >/etc/site-manager/host.env <<EOF
SITE_MANAGER_DOMAIN=${SITE_MANAGER_DOMAIN}
NNN_PREVIEW_DOMAIN=${NNN_PREVIEW_DOMAIN}
PLATFORM_SITE_BASE_DOMAIN=${PLATFORM_SITE_BASE_DOMAIN}
CADDY_EMAIL=${CADDY_EMAIL}
EOF
chown root:site-manager /etc/site-manager/host.env
chmod 0640 /etc/site-manager/host.env

install -m 0644 "$SCRIPT_DIR/site-manager.service" /etc/systemd/system/site-manager.service
install -m 0644 "$SCRIPT_DIR/site-manager-backup.service" /etc/systemd/system/site-manager-backup.service
install -m 0644 "$SCRIPT_DIR/site-manager-backup.timer" /etc/systemd/system/site-manager-backup.timer
systemctl daemon-reload
systemctl enable site-manager.service site-manager-backup.timer

caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
if [[ "$CADDY_APPLY" == "YES" ]]; then
  # A restart is intentional on first activation so Caddy receives the newly-added
  # site-manager-runtime supplementary group before it reads shared runtime/routes.
  systemctl restart caddy
else
  echo "Caddy configuration validated but was not activated. Set CADDY_APPLY=YES only during an intentional host cutover."
fi

echo "VPS filesystem and service layout prepared."
echo "No GitHub/nnn production-write credentials were installed on the VPS."
echo "Next: run provision-postgres.sh, install a Site Manager release, then install the explicitly approved nnn integration release."
