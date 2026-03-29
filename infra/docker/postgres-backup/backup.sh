#!/bin/sh
set -eu

backup_dir="${BACKUP_DIR:-/backups}"
interval="${BACKUP_INTERVAL_SECONDS:-21600}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"
db_host="${POSTGRES_HOST:-postgres}"
db_port="${POSTGRES_PORT:-5432}"
db_name="${POSTGRES_DB:-agentic_msp}"
db_user="${POSTGRES_USER:-postgres}"

mkdir -p "$backup_dir"

read_secret() {
  var_name="$1"
  file_var_name="${var_name}_FILE"
  file_path="$(printenv "$file_var_name" || true)"
  if [ -n "$file_path" ] && [ -f "$file_path" ]; then
    cat "$file_path"
    return
  fi

  printenv "$var_name" || true
}

db_password="$(read_secret POSTGRES_PASSWORD)"
export PGPASSWORD="$db_password"

while true; do
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  output_path="${backup_dir}/${db_name}-${timestamp}.sql.gz"

  pg_dump \
    --host="$db_host" \
    --port="$db_port" \
    --username="$db_user" \
    --dbname="$db_name" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    | gzip -9 > "$output_path"

  find "$backup_dir" -type f -name "*.sql.gz" -mtime +"$retention_days" -delete
  sleep "$interval"
done
