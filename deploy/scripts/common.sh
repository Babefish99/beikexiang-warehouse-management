#!/bin/sh

read_literal_value() {
  literal_file=$1
  literal_key=$2
  awk -v wanted="$literal_key" '
    BEGIN { found = 0 }
    {
      line = $0
      sub(/\r$/, "", line)
      if (line ~ "^[[:space:]]*" wanted "[[:space:]]*=") {
        found++
        if (found > 1) exit 2
        sub("^[[:space:]]*" wanted "[[:space:]]*=[[:space:]]*", "", line)
        sub(/[[:space:]]+#[^#]*$/, "", line)
        sub(/[[:space:]]*$/, "", line)
        first = substr(line, 1, 1)
        last = substr(line, length(line), 1)
        if (length(line) >= 2 && ((first == "\"" && last == "\"") || (first == "\047" && last == "\047"))) {
          line = substr(line, 2, length(line) - 2)
        }
        print line
      }
    }
    END {
      if (found == 0) exit 1
      if (found > 1) exit 2
    }
  ' "$literal_file"
}

require_mode_600() {
  protected_file=$1
  protected_mode=$(stat -c '%a' "$protected_file")
  [ "$protected_mode" = "600" ] || {
    printf 'ERROR: %s must have mode 600 (found %s)\n' "$protected_file" "$protected_mode" >&2
    return 1
  }
}

require_release_name() {
  release_name=$1
  case "$release_name" in
    ''|*[!A-Za-z0-9_.-]*)
      printf 'ERROR: invalid release name: %s\n' "$release_name" >&2
      return 1
      ;;
  esac
}

read_deployment_identity() {
  identity_file=$1
  COMPOSE_PROJECT_NAME_LITERAL=$(read_literal_value "$identity_file" COMPOSE_PROJECT_NAME) || {
    printf 'ERROR: COMPOSE_PROJECT_NAME must appear exactly once in %s\n' "$identity_file" >&2
    return 1
  }
  IMAGE_PREFIX_LITERAL=$(read_literal_value "$identity_file" IMAGE_PREFIX) || {
    printf 'ERROR: IMAGE_PREFIX must appear exactly once in %s\n' "$identity_file" >&2
    return 1
  }

  case "$COMPOSE_PROJECT_NAME_LITERAL" in
    [a-z0-9]* ) ;;
    * ) printf 'ERROR: invalid COMPOSE_PROJECT_NAME\n' >&2; return 1 ;;
  esac
  case "$COMPOSE_PROJECT_NAME_LITERAL" in
    *[!a-z0-9_-]* ) printf 'ERROR: invalid COMPOSE_PROJECT_NAME\n' >&2; return 1 ;;
  esac
  case "$IMAGE_PREFIX_LITERAL" in
    [A-Za-z0-9]* ) ;;
    * ) printf 'ERROR: invalid IMAGE_PREFIX\n' >&2; return 1 ;;
  esac
  case "$IMAGE_PREFIX_LITERAL" in
    *[!A-Za-z0-9._:/-]* ) printf 'ERROR: invalid IMAGE_PREFIX\n' >&2; return 1 ;;
  esac
}

validate_application_safety() {
  safety_file=$1
  persistence_driver=$(read_literal_value "$safety_file" PERSISTENCE_DRIVER) || {
    printf 'ERROR: PERSISTENCE_DRIVER must appear exactly once in %s\n' "$safety_file" >&2
    return 1
  }
  if local_auth_bypass=$(read_literal_value "$safety_file" LOCAL_AUTH_BYPASS); then
    :
  else
    local_auth_status=$?
    if [ "$local_auth_status" = "1" ]; then
      local_auth_bypass=false
    else
      printf 'ERROR: LOCAL_AUTH_BYPASS must appear at most once in %s\n' "$safety_file" >&2
      return 1
    fi
  fi
  [ "$persistence_driver" = "prisma" ] || {
    printf 'ERROR: PERSISTENCE_DRIVER must be prisma\n' >&2
    return 1
  }
  [ "$local_auth_bypass" = "false" ] || {
    printf 'ERROR: LOCAL_AUTH_BYPASS must be false\n' >&2
    return 1
  }
}

wait_for_service() {
  wait_service=$1
  wait_attempts=${2:-60}
  wait_count=0
  while [ "$wait_count" -lt "$wait_attempts" ]; do
    wait_container_id=$(compose ps -q "$wait_service")
    if [ -n "$wait_container_id" ]; then
      wait_status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$wait_container_id")
      if [ "$wait_status" = "healthy" ]; then
        return 0
      fi
      case "$wait_status" in
        unhealthy|exited|dead)
          printf 'ERROR: %s entered terminal state: %s\n' "$wait_service" "$wait_status" >&2
          return 1
          ;;
      esac
    fi
    wait_count=$((wait_count + 1))
    sleep 2
  done
  printf 'ERROR: %s did not become healthy\n' "$wait_service" >&2
  return 1
}
