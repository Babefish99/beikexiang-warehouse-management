#!/bin/sh
set -eu

umask 077

PROJECT_DIR=${PROJECT_DIR:-/opt/beikexiang-warehouse}
COMPOSE_FILE=${COMPOSE_FILE:-$PROJECT_DIR/docker-compose.prod.yml}
ENV_FILE=${ENV_FILE:-$PROJECT_DIR/deploy/.env.production}
BACKUP_DIR=${BACKUP_DIR:-$PROJECT_DIR/deploy/backups}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}

compose() {
  docker compose --project-directory "$PROJECT_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

if [ ! -f "$ENV_FILE" ]; then
  echo "environment file not found: $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
final_file="$BACKUP_DIR/warehouse-$timestamp.sql.gz"
sql_temp="$BACKUP_DIR/.warehouse-$timestamp.sql.tmp"
compressed_temp="${final_file}.tmp"

cleanup() {
  rm -f "$sql_temp" "$compressed_temp"
}
trap cleanup EXIT HUP INT TERM

container_id=$(compose ps -q postgres)
if [ -z "$container_id" ]; then
  echo "postgres container is not running; refusing to create an empty backup" >&2
  exit 1
fi

compose exec -T postgres sh -c 'pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$sql_temp"
if [ ! -s "$sql_temp" ]; then
  echo "pg_dump produced an empty file" >&2
  exit 1
fi

gzip -9 -c "$sql_temp" > "$compressed_temp"
gzip -t "$compressed_temp"
chmod 600 "$compressed_temp"
mv "${final_file}.tmp" "$final_file"
rm -f "$sql_temp"
trap - EXIT HUP INT TERM

find "$BACKUP_DIR" -type f -name 'warehouse-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
printf '%s\n' "$final_file"
