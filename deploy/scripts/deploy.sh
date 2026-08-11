#!/bin/sh
set -eu

umask 077

PROJECT_DIR=${PROJECT_DIR:-/opt/beikexiang-warehouse}
COMPOSE_FILE=${COMPOSE_FILE:-$PROJECT_DIR/docker-compose.prod.yml}
ENV_FILE=${ENV_FILE:-$PROJECT_DIR/deploy/.env.production}
SCRIPT_DIR=$PROJECT_DIR/deploy/scripts
COMMON_SCRIPT=$SCRIPT_DIR/common.sh
STATE_DIR=$PROJECT_DIR/deploy/state
RELEASES_DIR=$PROJECT_DIR/deploy/releases
LOG_DIR=$PROJECT_DIR/deploy/logs

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[ -f "$COMMON_SCRIPT" ] || fail "common script not found: $COMMON_SCRIPT"
. "$COMMON_SCRIPT"
[ -f "$COMPOSE_FILE" ] || fail "compose file not found: $COMPOSE_FILE"
[ -f "$ENV_FILE" ] || fail "environment file not found: $ENV_FILE"
require_mode_600 "$ENV_FILE"
read_deployment_identity "$ENV_FILE"
validate_application_safety "$ENV_FILE"

compose() {
  docker compose --project-directory "$PROJECT_DIR" --project-name "$COMPOSE_PROJECT_NAME_LITERAL" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

compose config --quiet
if [ "${VALIDATE_ONLY:-0}" = "1" ]; then
  printf 'Deployment configuration is valid for project %s.\n' "$COMPOSE_PROJECT_NAME_LITERAL"
  exit 0
fi

mkdir -p "$STATE_DIR" "$RELEASES_DIR" "$LOG_DIR"
chmod 700 "$STATE_DIR" "$RELEASES_DIR" "$LOG_DIR"
log_file="$LOG_DIR/deploy-$(date -u +%Y%m%dT%H%M%SZ)-$$.log"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$log_file"
}

current_release_file=$STATE_DIR/current-release
previous_release_file=$STATE_DIR/previous-release
current_release=
if [ -s "$current_release_file" ]; then
  current_release=$(sed -n '1p' "$current_release_file")
  require_release_name "$current_release"
  current_meta=$RELEASES_DIR/$current_release/release.meta
  [ -f "$current_meta" ] || fail "current release metadata is missing: $current_meta"
  current_project=$(read_literal_value "$current_meta" compose_project_name) || fail "current release project metadata is invalid"
  [ "$current_project" = "$COMPOSE_PROJECT_NAME_LITERAL" ] || fail "COMPOSE_PROJECT_NAME cannot change within an existing release history"
fi

source_revision=${SOURCE_REVISION:-}
if [ -z "$source_revision" ]; then
  source_revision=$(git -C "$PROJECT_DIR" rev-parse --short=12 HEAD)
fi
case "$source_revision" in
  ''|*[!A-Za-z0-9_.-]*) fail "invalid source revision" ;;
esac

release_tag="$(date -u +%Y%m%dT%H%M%SZ)-$source_revision-$$"
require_release_name "$release_tag"
release_stage=$RELEASES_DIR/.$release_tag.tmp
release_dir=$RELEASES_DIR/$release_tag
[ ! -e "$release_stage" ] || fail "release staging path already exists: $release_stage"
[ ! -e "$release_dir" ] || fail "release already exists: $release_dir"
mkdir "$release_stage"
chmod 700 "$release_stage"
cp "$ENV_FILE" "$release_stage/.env.production"
cp "$COMPOSE_FILE" "$release_stage/docker-compose.prod.yml"
chmod 600 "$release_stage/.env.production" "$release_stage/docker-compose.prod.yml"

export RELEASE_TAG=$release_tag
migrate_image=$IMAGE_PREFIX_LITERAL/migrate:$release_tag
api_image=$IMAGE_PREFIX_LITERAL/api:$release_tag
web_image=$IMAGE_PREFIX_LITERAL/web:$release_tag

prebuilt_mode=0
image_source=build
if [ -n "${PREBUILT_MIGRATE_IMAGE:-}${PREBUILT_API_IMAGE:-}${PREBUILT_WEB_IMAGE:-}" ]; then
  [ -n "${PREBUILT_MIGRATE_IMAGE:-}" ] || fail "PREBUILT_MIGRATE_IMAGE is required when using prebuilt images"
  [ -n "${PREBUILT_API_IMAGE:-}" ] || fail "PREBUILT_API_IMAGE is required when using prebuilt images"
  [ -n "${PREBUILT_WEB_IMAGE:-}" ] || fail "PREBUILT_WEB_IMAGE is required when using prebuilt images"
  prebuilt_mode=1
  image_source=prebuilt
  docker image inspect "$PREBUILT_MIGRATE_IMAGE" >/dev/null
  docker image inspect "$PREBUILT_API_IMAGE" >/dev/null
  docker image inspect "$PREBUILT_WEB_IMAGE" >/dev/null
fi

postgres_was_stopped=0
deployment_complete=0
recover_postgres() {
  exit_status=$?
  if [ "$exit_status" -ne 0 ] && [ "$postgres_was_stopped" = "1" ] && [ "$deployment_complete" = "0" ]; then
    log "deployment failed; restarting PostgreSQL only and leaving application services stopped for operator review"
    compose up -d postgres >> "$log_file" 2>&1 || true
  fi
  exit "$exit_status"
}
trap recover_postgres EXIT HUP INT TERM

log "starting PostgreSQL before the pre-deployment backup"
compose up -d postgres >> "$log_file" 2>&1
wait_for_service postgres 60
log "PostgreSQL is healthy"
backup_file=$(PROJECT_DIR="$PROJECT_DIR" COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" BACKUP_REASON="pre-deploy:$release_tag" "$SCRIPT_DIR/backup.sh")
[ -s "$backup_file" ] || fail "pre-deployment backup is missing: $backup_file"
[ -s "${backup_file}.manifest" ] || fail "pre-deployment backup manifest is missing"
cp "${backup_file}.manifest" "$release_stage/backup.manifest"
chmod 600 "$release_stage/backup.manifest"
log "database backup created: $backup_file"

log "stopping API and Web for the bounded-memory deployment"
compose stop api web >> "$log_file" 2>&1 || true
log "stopping PostgreSQL while images build to preserve host memory"
compose stop postgres >> "$log_file" 2>&1
postgres_was_stopped=1

if [ "$prebuilt_mode" = "1" ]; then
  log "tagging operator-supplied prebuilt images for release $release_tag"
  docker image tag "$PREBUILT_MIGRATE_IMAGE" "$migrate_image" >> "$log_file" 2>&1
  docker image tag "$PREBUILT_API_IMAGE" "$api_image" >> "$log_file" 2>&1
  docker image tag "$PREBUILT_WEB_IMAGE" "$web_image" >> "$log_file" 2>&1
else
  for build_service in migrate api web; do
    log "building $build_service image for release $release_tag"
    compose build "$build_service" >> "$log_file" 2>&1
  done
fi

migrate_image_id=$(docker image inspect --format '{{.Id}}' "$migrate_image")
api_image_id=$(docker image inspect --format '{{.Id}}' "$api_image")
web_image_id=$(docker image inspect --format '{{.Id}}' "$web_image")

{
  printf 'release_tag=%s\n' "$release_tag"
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'source_revision=%s\n' "$source_revision"
  printf 'compose_project_name=%s\n' "$COMPOSE_PROJECT_NAME_LITERAL"
  printf 'pre_upgrade_backup=%s\n' "$backup_file"
  printf 'image_source=%s\n' "$image_source"
  printf 'prebuilt_migrate_source=%s\n' "${PREBUILT_MIGRATE_IMAGE:-}"
  printf 'prebuilt_api_source=%s\n' "${PREBUILT_API_IMAGE:-}"
  printf 'prebuilt_web_source=%s\n' "${PREBUILT_WEB_IMAGE:-}"
  printf 'migrate_image=%s\n' "$migrate_image"
  printf 'migrate_image_id=%s\n' "$migrate_image_id"
  printf 'api_image=%s\n' "$api_image"
  printf 'api_image_id=%s\n' "$api_image_id"
  printf 'web_image=%s\n' "$web_image"
  printf 'web_image_id=%s\n' "$web_image_id"
} > "$release_stage/release.meta"
chmod 600 "$release_stage/release.meta"

log "starting PostgreSQL after sequential image builds"
compose up -d postgres >> "$log_file" 2>&1
postgres_was_stopped=0
wait_for_service postgres 60
log "running one-shot migrations and seed"
compose run --rm migrate >> "$log_file" 2>&1
log "starting API and Web; this deployment intentionally includes downtime"
compose up -d --no-deps api web >> "$log_file" 2>&1
wait_for_service api 60
wait_for_service web 60

mv "$release_stage" "$release_dir"
if [ -n "$current_release" ]; then
  printf '%s\n' "$current_release" > "${previous_release_file}.tmp"
  chmod 600 "${previous_release_file}.tmp"
  mv "${previous_release_file}.tmp" "$previous_release_file"
fi
printf '%s\n' "$release_tag" > "${current_release_file}.tmp"
chmod 600 "${current_release_file}.tmp"
mv "${current_release_file}.tmp" "$current_release_file"
deployment_complete=1
trap - EXIT HUP INT TERM
log "deployment complete with planned downtime: $release_tag"
log "evidence log: $log_file"
