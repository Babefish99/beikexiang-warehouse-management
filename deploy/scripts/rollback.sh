#!/bin/sh
set -eu

umask 077

PROJECT_DIR=${PROJECT_DIR:-/opt/beikexiang-warehouse}
COMPOSE_FILE=${COMPOSE_FILE:-$PROJECT_DIR/docker-compose.prod.yml}
ENV_FILE=${ENV_FILE:-$PROJECT_DIR/deploy/.env.production}
STATE_DIR=$PROJECT_DIR/deploy/state
SCRIPT_DIR=$PROJECT_DIR/deploy/scripts

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[ -f "$COMPOSE_FILE" ] || fail "compose file not found: $COMPOSE_FILE"
[ -f "$ENV_FILE" ] || fail "environment file not found: $ENV_FILE"
[ "$(stat -c '%a' "$ENV_FILE")" = "600" ] || fail "$ENV_FILE must have mode 600"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

current_release_file="$STATE_DIR/current-release"
previous_release_file="$STATE_DIR/previous-release"
[ -s "$previous_release_file" ] || fail "no previous-release record exists"

previous_release=$(sed -n '1p' "$previous_release_file")
current_release=""
if [ -s "$current_release_file" ]; then
  current_release=$(sed -n '1p' "$current_release_file")
fi

compose() {
  docker compose --project-directory "$PROJECT_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

for image_name in api web; do
  docker image inspect "${IMAGE_PREFIX:-warehouse}/$image_name:$previous_release" >/dev/null 2>&1 \
    || fail "rollback image is missing: ${IMAGE_PREFIX:-warehouse}/$image_name:$previous_release"
done

backup_file=$(PROJECT_DIR="$PROJECT_DIR" COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" "$SCRIPT_DIR/backup.sh")
printf 'Pre-rollback database backup: %s\n' "$backup_file"

export RELEASE_TAG=$previous_release
compose up -d --no-deps api web

for service in api web; do
  count=0
  while [ "$count" -lt 60 ]; do
    container_id=$(compose ps -q "$service")
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
    [ "$status" = "healthy" ] && break
    [ "$status" = "unhealthy" ] && fail "$service became unhealthy during rollback"
    count=$((count + 1))
    sleep 2
  done
  [ "$count" -lt 60 ] || fail "$service did not become healthy during rollback"
done

printf '%s\n' "$previous_release" > "${current_release_file}.tmp"
mv "${current_release_file}.tmp" "$current_release_file"
if [ -n "$current_release" ]; then
  printf '%s\n' "$current_release" > "${previous_release_file}.tmp"
  mv "${previous_release_file}.tmp" "$previous_release_file"
fi

printf 'Rolled back application images to %s without changing the PostgreSQL volume.\n' "$previous_release"
printf 'Schema is not rolled back; schema rollback and backup restore are separate explicit operations.\n'
