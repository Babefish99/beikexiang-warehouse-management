#!/bin/sh
set -eu

umask 077

PROJECT_DIR=${PROJECT_DIR:-/opt/beikexiang-warehouse}
STATE_DIR=$PROJECT_DIR/deploy/state
RELEASES_DIR=$PROJECT_DIR/deploy/releases
SCRIPT_DIR=$PROJECT_DIR/deploy/scripts
COMMON_SCRIPT=$SCRIPT_DIR/common.sh

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[ -f "$COMMON_SCRIPT" ] || fail "common script not found: $COMMON_SCRIPT"
. "$COMMON_SCRIPT"

current_release_file=$STATE_DIR/current-release
previous_release_file=$STATE_DIR/previous-release
[ -s "$current_release_file" ] || fail "no current-release record exists"
[ -s "$previous_release_file" ] || fail "no previous-release record exists"
current_release=$(sed -n '1p' "$current_release_file")
previous_release=$(sed -n '1p' "$previous_release_file")
require_release_name "$current_release"
require_release_name "$previous_release"

current_dir=$RELEASES_DIR/$current_release
previous_dir=$RELEASES_DIR/$previous_release
current_env=$current_dir/.env.production
current_compose=$current_dir/docker-compose.prod.yml
previous_env=$previous_dir/.env.production
previous_compose=$previous_dir/docker-compose.prod.yml
previous_meta=$previous_dir/release.meta
for required_file in "$current_env" "$current_compose" "$previous_env" "$previous_compose" "$previous_meta"; do
  [ -f "$required_file" ] || fail "release snapshot file is missing: $required_file"
done
require_mode_600 "$current_env"
require_mode_600 "$previous_env"
require_mode_600 "$previous_compose"
read_deployment_identity "$previous_env"
validate_application_safety "$previous_env"
snapshot_project=$COMPOSE_PROJECT_NAME_LITERAL

compose() {
  docker compose --project-directory "$PROJECT_DIR" --project-name "$snapshot_project" --env-file "$previous_env" -f "$previous_compose" "$@"
}

compose config --quiet
if [ "${VALIDATE_ONLY:-0}" = "1" ]; then
  printf 'Rollback configuration is valid for release %s.\n' "$previous_release"
  exit 0
fi

api_image=$(read_literal_value "$previous_meta" api_image) || fail "previous API image metadata is invalid"
api_image_id=$(read_literal_value "$previous_meta" api_image_id) || fail "previous API image identity is invalid"
web_image=$(read_literal_value "$previous_meta" web_image) || fail "previous Web image metadata is invalid"
web_image_id=$(read_literal_value "$previous_meta" web_image_id) || fail "previous Web image identity is invalid"
for image_record in "$api_image|$api_image_id" "$web_image|$web_image_id"; do
  image_ref=${image_record%%|*}
  expected_id=${image_record#*|}
  actual_id=$(docker image inspect --format '{{.Id}}' "$image_ref" 2>/dev/null) || fail "rollback image is missing: $image_ref"
  [ "$actual_id" = "$expected_id" ] || fail "rollback image identity changed for $image_ref"
done

backup_file=$(PROJECT_DIR="$PROJECT_DIR" COMPOSE_FILE="$current_compose" ENV_FILE="$current_env" BACKUP_REASON="pre-rollback:$current_release" "$SCRIPT_DIR/backup.sh")
printf 'Pre-rollback database backup: %s\n' "$backup_file"

export RELEASE_TAG=$previous_release
compose up -d --no-deps api web
for rollback_service in api web; do
  wait_for_service "$rollback_service" 60 || {
    compose logs --no-color "$rollback_service" >&2 || true
    fail "$rollback_service failed health validation during rollback"
  }
done

printf '%s\n' "$previous_release" > "${current_release_file}.tmp"
chmod 600 "${current_release_file}.tmp"
mv "${current_release_file}.tmp" "$current_release_file"
printf '%s\n' "$current_release" > "${previous_release_file}.tmp"
chmod 600 "${previous_release_file}.tmp"
mv "${previous_release_file}.tmp" "$previous_release_file"

printf 'Rolled back configuration and verified application images to release %s without changing the PostgreSQL volume.\n' "$previous_release"
printf 'Schema is not rolled back; schema rollback and backup restore are separate explicit operations.\n'
