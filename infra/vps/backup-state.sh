#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="${SITE_MANAGER_BACKUP_DIR:-/srv/site-manager/data/backups}"
RETENTION_DAYS="${SITE_MANAGER_BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_ROOT/$STAMP"

[[ -r /etc/site-manager/database.env ]] || { echo "Missing /etc/site-manager/database.env" >&2; exit 1; }
# shellcheck disable=SC1091
source /etc/site-manager/database.env
command -v pg_dump >/dev/null 2>&1 || { echo "pg_dump is required." >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "tar is required." >&2; exit 1; }

install -d -m 0700 "$DEST"
pg_dump --format=custom --no-owner --no-privileges --file="$DEST/postgresql.dump" "$DATABASE_URL"

if [[ -d /srv/site-manager/data/uploads ]]; then
  tar -C /srv/site-manager/data -czf "$DEST/uploads.tar.gz" uploads
fi
if [[ -d /srv/site-manager/data/deployments ]]; then
  tar -C /srv/site-manager/data -czf "$DEST/deployments.tar.gz" deployments
fi

cat >"$DEST/backup.json" <<EOF
{
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "database": "postgresql.dump",
  "uploads": $([[ -f "$DEST/uploads.tar.gz" ]] && printf '"uploads.tar.gz"' || printf 'null'),
  "deployments": $([[ -f "$DEST/deployments.tar.gz" ]] && printf '"deployments.tar.gz"' || printf 'null')
}
EOF
chmod -R go-rwx "$DEST"

if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] && [[ "$RETENTION_DAYS" -gt 0 ]]; then
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENTION_DAYS" -exec rm -rf -- {} +
fi

echo "Site Manager backup complete: $DEST"
