#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run PostgreSQL provisioning as root." >&2
  exit 1
fi

DB_NAME="${DB_NAME:-site_manager}"
DB_USER="${DB_USER:-site_manager}"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 24)}"

for value in "$DB_NAME" "$DB_USER"; do
  if [[ ! "$value" =~ ^[a-zA-Z_][a-zA-Z0-9_]{0,62}$ ]]; then
    echo "Database/user names must be simple PostgreSQL identifiers." >&2
    exit 1
  fi
done
if [[ ! "$DB_PASSWORD" =~ ^[A-Za-z0-9._~-]{24,128}$ ]]; then
  echo "DB_PASSWORD must contain only URL-safe characters and be at least 24 characters." >&2
  exit 1
fi

systemctl start postgresql
sudo -u postgres psql --set=ON_ERROR_STOP=1 \
  --set=role="$DB_USER" --set=pass="$DB_PASSWORD" --set=db="$DB_NAME" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'role', :'pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'role', :'pass') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'role')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
SQL

install -d -m 0750 -o root -g site-manager /etc/site-manager
cat >/etc/site-manager/database.env <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
DB_POOL_MAX=10
DB_SSL=false
EOF
chown root:site-manager /etc/site-manager/database.env
chmod 0640 /etc/site-manager/database.env

echo "PostgreSQL database '$DB_NAME' and role '$DB_USER' are ready."
echo "Credentials were written to /etc/site-manager/database.env with restricted permissions."
