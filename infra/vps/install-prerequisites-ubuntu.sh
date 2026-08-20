#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run this prerequisite installer as root." >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "Unsupported host: /etc/os-release is missing." >&2
  exit 1
fi
# shellcheck disable=SC1091
source /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) echo "This installer supports Ubuntu/Debian hosts only. Found: ${ID:-unknown}" >&2; exit 1 ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git rsync jq openssl postgresql postgresql-client
install -d -m 0755 /etc/apt/keyrings /usr/share/keyrings

need_node=1
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
  if [[ "$node_major" -eq 22 || "$node_major" -eq 24 ]]; then need_node=0; fi
fi
if [[ "$need_node" -eq 1 ]]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
  cat >/etc/apt/sources.list.d/nodesource.list <<'EOF'
deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main
EOF
  apt-get update
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null 2>&1; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  chmod 0644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    -o /etc/apt/sources.list.d/caddy-stable.list
  chmod 0644 /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "$node_major" -ne 22 && "$node_major" -ne 24 ]]; then
  echo "Node.js 22 or 24 is required; found $(node --version)." >&2
  exit 1
fi

systemctl enable postgresql
systemctl enable caddy

echo "Prerequisites installed: $(node --version), $(caddy version | head -n1), PostgreSQL $(psql --version)."
