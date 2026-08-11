#!/bin/sh
set -eu

umask 077

PROJECT_DIR=${PROJECT_DIR:-/opt/beikexiang-warehouse}
COMPOSE_FILE=${COMPOSE_FILE:-$PROJECT_DIR/docker-compose.prod.yml}
ENV_FILE=${ENV_FILE:-$PROJECT_DIR/deploy/.env.production}
SCRIPT_DIR=$PROJECT_DIR/deploy/scripts
STATE_DIR=$PROJECT_DIR/deploy/state
LOG_DIR=$PROJECT_DIR/deploy/logs

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[ -f "$COMPOSE_FILE" ] || fail "compose file not found: $COMPOSE_FILE"
[ -f "$ENV_FILE" ] || fail "environment file not found: $ENV_FILE"

env_mode=$(stat -c '%a' "$ENV_FILE")
[ "$env_mode" = "600" ] || fail "$ENV_FILE must have mode 600 (found $env_mode)"

set -a
# The production environment file is administrator-owned configuration.
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

for required_name in SITE_ADDRESS NODE_ENV PERSISTENCE_DRIVER DATABASE_URL API_BASE_URL WEB_BASE_URL SESSION_SECRET POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD; do
  eval "required_value=\${$required_name-}"
  [ -n "$required_value" ] || fail "$required_name is required"
done
[ "$PERSISTENCE_DRIVER" = "prisma" ] || fail "PERSISTENCE_DRIVER must be prisma"
[ "${LOCAL_AUTH_BYPASS:-false}" = "false" ] || fail "LOCAL_AUTH_BYPASS must be false"

mkdir -p "$STATE_DIR" "$LOG_DIR"
chmod 700 "$STATE_DIR" "$LOG_DIR"
log_file="$LOG_DIR/deploy-$(date -u +%Y%m%dT%H%M%SZ).log"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$log_file"
}

compose() {
  docker compose --project-directory "$PROJECT_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

wait_healthy() {
  service=$1
  attempts=${2:-60}
  count=0
  while [ "$count" -lt "$attempts" ]; do
    container_id=$(compose ps -q "$service")
    if [ -n "$container_id" ]; then
      status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
      if [ "$status" = "healthy" ]; then
        log "$service is healthy"
        return 0
      fi
      if [ "$status" = "unhealthy" ] || [ "$status" = "exited" ] || [ "$status" = "dead" ]; then
        compose logs --no-color "$service" >> "$log_file" 2>&1 || true
        fail "$service entered terminal state: $status"
      fi
    fi
    count=$((count + 1))
    sleep 2
  done
  compose logs --no-color "$service" >> "$log_file" 2>&1 || true
  fail "$service did not become healthy"
}

current_release_file="$STATE_DIR/current-release"
previous_release_file="$STATE_DIR/previous-release"
current_release=""
if [ -s "$current_release_file" ]; then
  current_release=$(sed -n '1p' "$current_release_file")
fi

log "starting PostgreSQL before the pre-deployment backup"
compose up -d postgres >> "$log_file" 2>&1
wait_healthy postgres 60
backup_file=$(PROJECT_DIR="$PROJECT_DIR" COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" "$SCRIPT_DIR/backup.sh")
log "database backup created: $backup_file"

release_tag="$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$PROJECT_DIR" rev-parse --short=12 HEAD)"
export RELEASE_TAG=$release_tag

if [ -n "$current_release" ]; then
  printf '%s\n' "$current_release" > "${previous_release_file}.tmp"
  mv "${previous_release_file}.tmp" "$previous_release_file"
  log "recorded previous release: $current_release"
fi

log "building release $release_tag"
compose build migrate api web >> "$log_file" 2>&1

log "running one-shot migrations and seed"
compose run --rm migrate >> "$log_file" 2>&1

log "starting API and Web"
compose up -d --no-deps api web >> "$log_file" 2>&1
wait_healthy api 60
wait_healthy web 60

printf '%s\n' "$release_tag" > "${current_release_file}.tmp"
mv "${current_release_file}.tmp" "$current_release_file"
log "deployment complete: $release_tag"
log "evidence log: $log_file"
