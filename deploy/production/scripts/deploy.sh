#!/bin/sh

# This script is intentionally run from the checked-out production repository.
# Its only side effects are building and starting the defined Compose services.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$script_dir/.."

if [ ! -f .env ]; then
  echo "Missing deploy/production/.env; create it on the server with mode 600." >&2
  exit 1
fi

if [ ! -e ../../.git ]; then
  echo "Run this script from a checked-out restaurant-ops repository." >&2
  exit 1
fi

require_env() {
  value=$(eval "printf '%s' \"\${$1-}\"")
  if [ -z "$value" ]; then
    echo "Required environment value is missing: $1" >&2
    exit 1
  fi
}

# Load only into this release process. Never print these values.
set -a
. ./.env
set +a

require_env AUTH_TOKEN_SECRET
require_env POSTGRES_DB
require_env POSTGRES_USER
require_env POSTGRES_PASSWORD
require_env DATABASE_URL

if [ "${MODEL_PROVIDER:-}" = "openai_responses" ]; then
  require_env MODEL_MODEL
  require_env MODEL_API_KEY
  require_env MODEL_BASE_URL
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker Compose v2 is required on this host." >&2
  exit 1
fi

docker compose --env-file .env -f compose.yml up -d --build

attempt=0
max_attempts=30
while [ "$attempt" -lt "$max_attempts" ]; do
  if curl --fail --silent --show-error http://127.0.0.1:3000/health >/dev/null; then
    echo "Production API health check succeeded."
    exit 0
  fi

  attempt=$((attempt + 1))
  sleep 2
done

echo "Production API health check timed out; inspect redacted service logs locally." >&2
exit 1
