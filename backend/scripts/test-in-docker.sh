#!/bin/sh
# Runs the backend test suite inside the running dev container.
#
# Why this exists: docker-compose.yml deliberately does not publish Postgres
# to the host (see famlin-db in docker-compose.yml), so vitest can't reach it
# directly from outside Docker. The famlin-backend dev container already has
# network access to famlin-db by service name, so we exec into it instead —
# reusing its real DATABASE_URL/JWT_SECRET but swapping in a dedicated
# `<db>_test` database so the suite's table TRUNCATEs never touch real data
# (tests/setup/assert-test-database.ts also refuses to run otherwise).
set -e

CONTAINER="${FAMLIN_BACKEND_CONTAINER:-famlin-backend}"

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "Container '$CONTAINER' not found — start the dev stack first (docker compose up)." >&2
  exit 1
fi

REAL_DATABASE_URL=$(docker exec "$CONTAINER" printenv DATABASE_URL)
JWT_SECRET=$(docker exec "$CONTAINER" printenv JWT_SECRET)

# postgresql://user:pass@host:port/DBNAME?params -> .../DBNAME_test?params
TEST_DATABASE_URL=$(printf '%s' "$REAL_DATABASE_URL" | sed -E 's#^(postgresql://[^/]+/)([^/?]+)#\1\2_test#')
TEST_DB_NAME=$(printf '%s' "$TEST_DATABASE_URL" | sed -E 's#^.*/([^/?]+).*$#\1#')

# CREATE DATABASE has no IF NOT EXISTS, so check first.
DB_HOST_ARGS=$(printf '%s' "$REAL_DATABASE_URL" | sed -E 's#^postgresql://([^:]+):[^@]+@[^/]+/([^?]+).*$#-U \1#')
EXISTS=$(docker exec famlin-db psql $DB_HOST_ARGS -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$TEST_DB_NAME'")
if [ "$EXISTS" != "1" ]; then
  echo "Creating test database '$TEST_DB_NAME'..."
  docker exec famlin-db psql $DB_HOST_ARGS -d postgres -c "CREATE DATABASE $TEST_DB_NAME;"
fi

docker exec \
  -e NODE_ENV=test \
  -e DATABASE_URL="$TEST_DATABASE_URL" \
  -e JWT_SECRET="$JWT_SECRET" \
  -e PORT=3999 \
  "$CONTAINER" npm test -- "$@"
