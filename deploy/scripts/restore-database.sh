#!/bin/sh
set -eu

umask 077

PROJECT_DIR=${PROJECT_DIR:-/opt/beikexiang-warehouse}
RELEASES_DIR=$PROJECT_DIR/deploy/releases
SCRIPT_DIR=$PROJECT_DIR/deploy/scripts
COMMON_SCRIPT=$SCRIPT_DIR/common.sh

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

target_release=
confirmation=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --release)
      [ "$#" -ge 2 ] || fail "--release requires a value"
      target_release=$2
      shift 2
      ;;
    --confirm)
      [ "$#" -ge 2 ] || fail "--confirm requires a value"
      confirmation=$2
      shift 2
      ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[ -f "$COMMON_SCRIPT" ] || fail "common script not found: $COMMON_SCRIPT"
. "$COMMON_SCRIPT"
require_release_name "$target_release"

release_dir=$RELEASES_DIR/$target_release
snapshot_env=$release_dir/.env.production
snapshot_compose=$release_dir/docker-compose.prod.yml
release_meta=$release_dir/release.meta
backup_manifest=$release_dir/backup.manifest
for required_file in "$snapshot_env" "$snapshot_compose" "$release_meta" "$backup_manifest"; do
  [ -f "$required_file" ] || fail "release snapshot file is missing: $required_file"
done
require_mode_600 "$snapshot_env"
require_mode_600 "$snapshot_compose"
require_mode_600 "$backup_manifest"
read_deployment_identity "$snapshot_env"
validate_application_safety "$snapshot_env"

expected_confirmation="RESTORE_DATABASE:$COMPOSE_PROJECT_NAME_LITERAL:$target_release"
[ "$confirmation" = "$expected_confirmation" ] || fail "strong confirmation required: --confirm $expected_confirmation"

backup_file=$(read_literal_value "$backup_manifest" backup_file) || fail "backup path is missing from manifest"
expected_sha256=$(read_literal_value "$backup_manifest" sha256) || fail "backup checksum is missing from manifest"
expected_size=$(read_literal_value "$backup_manifest" size_bytes) || fail "backup size is missing from manifest"
[ -f "$backup_file" ] || fail "backup file is missing: $backup_file"
[ "$(wc -c < "$backup_file" | tr -d '[:space:]')" = "$expected_size" ] || fail "backup size does not match manifest"
[ "$(sha256sum "$backup_file" | awk '{print $1}')" = "$expected_sha256" ] || fail "backup checksum does not match manifest"
gzip -t "$backup_file"

compose() {
  docker compose --project-directory "$PROJECT_DIR" --project-name "$COMPOSE_PROJECT_NAME_LITERAL" --env-file "$snapshot_env" -f "$snapshot_compose" "$@"
}

compose config --quiet
compose up -d postgres
wait_for_service postgres 60

safety_backup=$(PROJECT_DIR="$PROJECT_DIR" COMPOSE_FILE="$snapshot_compose" ENV_FILE="$snapshot_env" BACKUP_REASON="pre-restore:$target_release" "$SCRIPT_DIR/backup.sh")
printf 'Second safety backup created before restore: %s\n' "$safety_backup"

compose stop api web || true
gzip -dc "$backup_file" | compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres'

printf 'Database restored from %s without deleting or replacing the PostgreSQL volume.\n' "$backup_file"
printf 'API and Web remain stopped. Verify the restored schema, then run rollback.sh or deploy.sh explicitly.\n'
