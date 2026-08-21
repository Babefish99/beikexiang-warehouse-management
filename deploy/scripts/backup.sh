#!/bin/sh
set -eu

umask 077

PROJECT_DIR=${PROJECT_DIR:-/opt/beikexiang-warehouse}
COMPOSE_FILE=${COMPOSE_FILE:-$PROJECT_DIR/docker-compose.prod.yml}
ENV_FILE=${ENV_FILE:-$PROJECT_DIR/deploy/.env.production}
BACKUP_DIR=${BACKUP_DIR:-$PROJECT_DIR/deploy/backups}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}
BACKUP_REASON=${BACKUP_REASON:-manual}
COMMON_SCRIPT=$PROJECT_DIR/deploy/scripts/common.sh

[ -f "$COMMON_SCRIPT" ] || { echo "common script not found: $COMMON_SCRIPT" >&2; exit 1; }
. "$COMMON_SCRIPT"

[ -f "$COMPOSE_FILE" ] || { echo "compose file not found: $COMPOSE_FILE" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "environment file not found: $ENV_FILE" >&2; exit 1; }
require_mode_600 "$ENV_FILE"
read_deployment_identity "$ENV_FILE"
case "$BACKUP_REASON" in
  ''|*[!A-Za-z0-9_.:-]*) echo "invalid BACKUP_REASON" >&2; exit 1 ;;
esac

compose() {
  docker compose --project-directory "$PROJECT_DIR" --project-name "$COMPOSE_PROJECT_NAME_LITERAL" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_id="$timestamp-$$"
final_file="$BACKUP_DIR/warehouse-$backup_id.sql.gz"
manifest_file="${final_file}.manifest"
sql_temp="$BACKUP_DIR/.warehouse-$backup_id.sql.tmp"
compressed_temp="${final_file}.tmp"
manifest_temp="${manifest_file}.tmp"

cleanup() {
  rm -f "$sql_temp" "$compressed_temp" "$manifest_temp"
}
trap cleanup EXIT HUP INT TERM

container_id=$(compose ps -q postgres)
if [ -z "$container_id" ]; then
  echo "postgres container is not running; refusing to create an empty backup" >&2
  exit 1
fi

compose exec -T postgres sh -c 'pg_dump --clean --if-exists --create --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$sql_temp"
if [ ! -s "$sql_temp" ]; then
  echo "pg_dump produced an empty file" >&2
  exit 1
fi

gzip -9 -c "$sql_temp" > "$compressed_temp"
gzip -t "$compressed_temp"
chmod 600 "$compressed_temp"
mv "${final_file}.tmp" "$final_file"
backup_sha256=$(sha256sum "$final_file" | awk '{print $1}')
backup_size=$(wc -c < "$final_file" | tr -d '[:space:]')
{
  printf 'backup_file=%s\n' "$final_file"
  printf 'sha256=%s\n' "$backup_sha256"
  printf 'size_bytes=%s\n' "$backup_size"
  printf 'created_at=%s\n' "$timestamp"
  printf 'compose_project_name=%s\n' "$COMPOSE_PROJECT_NAME_LITERAL"
  printf 'reason=%s\n' "$BACKUP_REASON"
} > "$manifest_temp"
chmod 600 "$manifest_temp"
mv "$manifest_temp" "$manifest_file"
rm -f "$sql_temp"
trap - EXIT HUP INT TERM

find "$BACKUP_DIR" -type f -name 'warehouse-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -type f -name 'warehouse-*.sql.gz.manifest' -mtime +"$RETENTION_DAYS" -delete
printf '%s\n' "$final_file"
