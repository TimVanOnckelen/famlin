#!/bin/sh
# Add-on entrypoint: bundled PostgreSQL + the Famlin server in one container.
# Runs as root only to prepare /data; postgres and node drop privileges.
set -eu

DATA=/data
PGDATA="$DATA/postgres"
PGRUN=/run/postgresql
OPTIONS=$DATA/options.json

# Alpine installs the server binaries of postgresql16 under a versioned
# directory; the base image also carries a newer client, so never rely on PATH.
PGBIN=/usr/libexec/postgresql16

log() { echo "[famlin-addon] $*"; }

trust_proxy=false
if [ -f "$OPTIONS" ]; then
  trust_proxy=$(jq -r '.trust_proxy // false' "$OPTIONS")
fi

mkdir -p "$DATA/uploads" "$DATA/backups" "$DATA/famlin" "$PGRUN"
# A recursive chown over a large photo library on every start is slow: only
# do it when the top-level owner is wrong.
for d in "$DATA/uploads" "$DATA/backups" "$DATA/famlin"; do
  [ "$(stat -c %U "$d")" = node ] || chown -R node:node "$d"
done
chown postgres:postgres "$PGRUN"

# Database password: random, created once, kept in /data (so in HA backups).
PWFILE="$DATA/postgres_password"
if [ ! -s "$PWFILE" ]; then
  (umask 077; head -c 96 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40 > "$PWFILE")
fi
chmod 600 "$PWFILE"
chown root:root "$PWFILE"
PGPASSWORD_VALUE=$(cat "$PWFILE")

# Signing secret for logins. Generated once and kept next to the data, so it
# works with images that predate the built-in generator and with those that
# have it (an explicit JWT_SECRET always wins there).
JWTFILE="$DATA/famlin/jwt_secret"
if [ ! -s "$JWTFILE" ]; then
  (umask 077; head -c 96 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 64 > "$JWTFILE")
  chown node:node "$JWTFILE"
fi

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  log "Initialising PostgreSQL in $PGDATA"
  mkdir -p "$PGDATA"
  chown postgres:postgres "$PGDATA"
  chmod 700 "$PGDATA"
  # initdb reads the password from a file the postgres user can read once.
  tmp_pw=$(mktemp)
  printf %s "$PGPASSWORD_VALUE" > "$tmp_pw"
  chown postgres:postgres "$tmp_pw"
  su-exec postgres "$PGBIN/initdb" -D "$PGDATA" -U famlin --pwfile="$tmp_pw" \
    --auth-local=scram-sha-256 --auth-host=scram-sha-256 --encoding=UTF8 >/dev/null
  rm -f "$tmp_pw"
fi

log "Starting PostgreSQL"
# Listens on localhost only; nothing outside this container can reach it.
su-exec postgres "$PGBIN/pg_ctl" -D "$PGDATA" -w -t 60 \
  -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories=$PGRUN" start >/dev/null

# psql/createdb: the matching ones if the package ships them, else the client.
PSQL=psql CREATEDB=createdb
[ ! -x "$PGBIN/psql" ] || PSQL="$PGBIN/psql"
[ ! -x "$PGBIN/createdb" ] || CREATEDB="$PGBIN/createdb"

if ! PGPASSWORD="$PGPASSWORD_VALUE" "$PSQL" -h 127.0.0.1 -U famlin -d postgres -tAc \
     "SELECT 1 FROM pg_database WHERE datname='famlin'" | grep -q 1; then
  log "Creating database"
  PGPASSWORD="$PGPASSWORD_VALUE" "$CREATEDB" -h 127.0.0.1 -U famlin famlin
fi

stop_all() {
  log "Stopping"
  if [ -n "${NODE_PID:-}" ]; then
    kill -TERM "$NODE_PID" 2>/dev/null || true
    wait "$NODE_PID" 2>/dev/null || true
  fi
  su-exec postgres "$PGBIN/pg_ctl" -D "$PGDATA" -m fast -w -t 60 stop >/dev/null || true
}
trap 'stop_all; exit 0' TERM INT

export NODE_ENV=production
export PORT=3000
export POSTGRES_HOST=127.0.0.1
export POSTGRES_USER=famlin
export POSTGRES_DB=famlin
export POSTGRES_PASSWORD="$PGPASSWORD_VALUE"
export DATA_DIR="$DATA/famlin"
export UPLOADS_DIR="$DATA/uploads"
export BACKUPS_DIR="$DATA/backups"
export JWT_SECRET="${JWT_SECRET:-$(cat "$JWTFILE")}"
export TRUST_PROXY="$trust_proxy"
# Older images do not build DATABASE_URL themselves; setting it is harmless.
PW_URL=$PGPASSWORD_VALUE # alphanumeric only, so no URL encoding is needed
export DATABASE_URL="postgresql://famlin:${PW_URL}@127.0.0.1:5432/famlin"

log "Starting Famlin (trust_proxy=$trust_proxy)"
cd /app
su-exec node node dist/boot.js &
NODE_PID=$!

# If PostgreSQL dies underneath a running server, exit so the supervisor
# restarts the whole add-on instead of leaving node without a database.
(
  while sleep 30; do
    if ! su-exec postgres "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
      echo "[famlin-addon] PostgreSQL is not running; stopping the add-on"
      kill -TERM "$NODE_PID" 2>/dev/null
      exit 0
    fi
  done
) &
WATCH_PID=$!

# Wait for node; if it exits on its own, stop postgres and report its status.
status=0
wait "$NODE_PID" || status=$?
kill "$WATCH_PID" 2>/dev/null || true
NODE_PID=
stop_all
exit "$status"
