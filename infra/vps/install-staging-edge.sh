#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "install-staging-edge.sh must run as root." >&2
  exit 1
fi

SITE_MANAGER_ENVIRONMENT="${SITE_MANAGER_ENVIRONMENT:-}"
STAGING_EDGE_APPROVED="${STAGING_EDGE_APPROVED:-NO}"
STAGING_EDGE_HOSTNAME="${STAGING_EDGE_HOSTNAME:-}"
STAGING_EDGE_HTTPS_PORT="${STAGING_EDGE_HTTPS_PORT:-443}"
STAGING_EDGE_TLS_MODE="${STAGING_EDGE_TLS_MODE:-public}"

if [[ "$SITE_MANAGER_ENVIRONMENT" != "staging" ]]; then
  echo "Refusing staging-edge installation: SITE_MANAGER_ENVIRONMENT must equal staging." >&2
  exit 1
fi
if [[ "$STAGING_EDGE_APPROVED" != "YES" ]]; then
  echo "Refusing staging-edge installation: STAGING_EDGE_APPROVED must equal YES." >&2
  exit 1
fi
if [[ -z "$STAGING_EDGE_HOSTNAME" ]]; then
  echo "Refusing staging-edge installation: STAGING_EDGE_HOSTNAME is required." >&2
  exit 1
fi
if ! command -v caddy >/dev/null 2>&1; then
  echo "Caddy is not installed. Run install-prerequisites-ubuntu.sh first." >&2
  exit 1
fi
if ! id site-manager >/dev/null 2>&1; then
  echo "site-manager system user is missing. Run install-host.sh first." >&2
  exit 1
fi
if ! id caddy >/dev/null 2>&1; then
  echo "caddy system user is missing." >&2
  exit 1
fi

install -d -m 0750 -o site-manager -g site-manager /etc/site-manager/staging
usermod -a -G site-manager caddy

ADDRESS="$STAGING_EDGE_HOSTNAME"
if [[ "$STAGING_EDGE_HTTPS_PORT" != "443" ]]; then
  ADDRESS="https://${STAGING_EDGE_HOSTNAME}:${STAGING_EDGE_HTTPS_PORT}"
fi
TLS_DIRECTIVE=""
if [[ "$STAGING_EDGE_TLS_MODE" == "internal" ]]; then
  TLS_DIRECTIVE="  tls internal"
fi

cat >/etc/site-manager/staging/Caddyfile <<EOF
{
  admin 127.0.0.1:2020
}

${ADDRESS} {
${TLS_DIRECTIVE}
  respond "Site Manager staging edge is idle" 503
}
EOF
chown site-manager:site-manager /etc/site-manager/staging/Caddyfile
chmod 0640 /etc/site-manager/staging/Caddyfile

install -m 0644 "$(dirname "$0")/site-manager-staging-caddy.service" /etc/systemd/system/site-manager-staging-caddy.service

# The staging VPS uses its own dedicated Caddy process. Never run this installer on
# a production customer edge; the environment/approval checks above are deliberate.
if systemctl list-unit-files caddy.service >/dev/null 2>&1; then
  systemctl disable --now caddy.service >/dev/null 2>&1 || true
fi
systemctl daemon-reload
systemctl enable --now site-manager-staging-caddy.service

if [[ -f /etc/site-manager/site-manager.env ]]; then
  set_env() {
    local key="$1" value="$2" file=/etc/site-manager/site-manager.env
    if grep -q "^${key}=" "$file"; then
      sed -i "s|^${key}=.*|${key}=${value}|" "$file"
    else
      printf '%s=%s\n' "$key" "$value" >>"$file"
    fi
  }
  set_env SITE_MANAGER_ENVIRONMENT staging
  set_env STAGING_EDGE_MODE staging
  set_env STAGING_EDGE_APPROVED YES
  set_env STAGING_EDGE_HOSTNAME "$STAGING_EDGE_HOSTNAME"
  set_env STAGING_EDGE_HTTPS_PORT "$STAGING_EDGE_HTTPS_PORT"
  set_env STAGING_EDGE_TLS_MODE "$STAGING_EDGE_TLS_MODE"
  set_env STAGING_EDGE_CADDY_ADMIN 127.0.0.1:2020
  set_env STAGING_EDGE_CADDYFILE /etc/site-manager/staging/Caddyfile
  set_env STAGING_EDGE_STATE_DIR /srv/site-manager/data/staging-edge
  set_env STAGING_CADDY_BIN /usr/bin/caddy
  set_env STAGING_EDGE_CURL_BIN /usr/bin/curl
  set_env NNN_STAGING_DIST_DIR /srv/site-manager/nnn/current
  chmod 0640 /etc/site-manager/site-manager.env
fi

systemctl restart site-manager.service >/dev/null 2>&1 || true

echo "Isolated staging edge installed for ${STAGING_EDGE_HOSTNAME}."
echo "Production customer publishing remains separate and is not enabled by this script."
