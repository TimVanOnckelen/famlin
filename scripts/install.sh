#!/bin/sh
# Famlin installer for a fresh Debian/Ubuntu server.
#
#   curl -fsSL https://famlin.app/install.sh | sh
#   curl -fsSL https://famlin.app/install.sh | sh -s -- --help
#
# What it does, in order (re-running it upgrades/repairs and never deletes data):
#   1. installs Docker + the compose plugin from Docker's official apt repo
#   2. downloads the compose files of the latest Famlin release into /opt/famlin
#   3. asks how Famlin should be reached (Caddy HTTPS / Cloudflare Tunnel / local)
#      and records the answer in /opt/famlin/.env
#   4. optionally installs a daily systemd timer that updates Famlin
#   5. starts everything and waits until the server answers
#
# Read it before you run it: curl -fsSLO https://famlin.app/install.sh
set -eu

REPO="TimVanOnckelen/famlin"
DIR="/opt/famlin"
REL=""          # empty = latest release; or e.g. v1.4.0
CHANNEL="latest"    # latest = auto-update follows new releases; release = stay on the downloaded release
MODE=""             # caddy | tunnel | local
DOMAIN="" EMAIL="" TUNNEL_TOKEN=""
AUTO_UPDATE=1 YES=0 DRY_RUN=0

usage() {
  cat <<USAGE
Usage: install.sh [options]
  --dir PATH           install directory (default: $DIR)
  --mode MODE          caddy (HTTPS on your domain), tunnel (Cloudflare Tunnel)
                       or local (plain http on port 3000, for a LAN or testing)
  --domain NAME        caddy: the domain pointing at this server
  --email ADDRESS      caddy: optional contact address for Let's Encrypt
  --tunnel-token TOKEN tunnel: the Cloudflare tunnel token
  --version vX.Y.Z     install a specific release (also pins the image to it)
  --channel CHANNEL    latest (default): updates follow the newest release
                       release: stay on the downloaded release's image
  --no-auto-update     do not install the daily update timer
  --yes                never ask; use flags, existing .env values and defaults
  --dry-run            print what would happen, change nothing
  --help               show this help
USAGE
}

# --- helpers -----------------------------------------------------------------
say()  { printf '==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Run a command (with sudo if needed); in --dry-run only print it.
run() {
  if [ "$DRY_RUN" = 1 ]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi
}

# Ask a question on the terminal (stdin may be the curl pipe). Sets $REPLY.
# ask "Question" "default"; with --yes (or no terminal) the default is used.
ask() {
  REPLY="$2"
  [ "$YES" = 1 ] && return 0
  if ! (: </dev/tty) 2>/dev/null; then
    die "no terminal to ask '$1' - pass the options as flags and add --yes (see --help)"
  fi
  printf '%s%s: ' "$1" "${2:+ [$2]}" >/dev/tty
  read -r REPLY </dev/tty || REPLY=""
  [ -n "$REPLY" ] || REPLY="$2"
}

# Value of KEY in $DIR/.env (empty if missing).
env_get() { [ -f "$DIR/.env" ] && $SUDO sed -n "s/^$1=//p" "$DIR/.env" | tail -n 1 || true; }

# Set KEY=VALUE in $DIR/.env: replaces our own line, appends otherwise, and
# leaves every other line (your own edits, comments) untouched.
env_set() {
  if [ "$DRY_RUN" = 1 ]; then printf '[dry-run] .env: %s=%s\n' "$1" "$2"; return 0; fi
  $SUDO touch "$DIR/.env" && $SUDO chmod 600 "$DIR/.env"
  tmp=$(mktemp)
  { $SUDO grep -v "^$1=" "$DIR/.env" 2>/dev/null || true; printf '%s=%s\n' "$1" "$2"; } >"$tmp"
  $SUDO cp "$tmp" "$DIR/.env" && rm -f "$tmp"
}

# Write stdin to a root-owned file.
write_file() {
  if [ "$DRY_RUN" = 1 ]; then printf '[dry-run] write %s\n' "$1"; cat >/dev/null; return 0; fi
  $SUDO tee "$1" >/dev/null
}

# Everything below runs inside main(), called on the last line: when piped
# (`curl | sh`) the shell reads the script from stdin as it goes, so a child
# process (apt, docker) that read stdin could otherwise swallow the rest of it.
main() {
# --- arguments ---------------------------------------------------------------
while [ $# -gt 0 ]; do
  case $1 in
    --help|-h) usage; exit 0 ;;
    --yes|-y) YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --no-auto-update) AUTO_UPDATE=0 ;;
    --dir|--mode|--domain|--email|--tunnel-token|--version|--channel)
      [ $# -ge 2 ] || die "$1 needs a value"
      case $1 in
        --dir) DIR=$2 ;; --mode) MODE=$2 ;; --domain) DOMAIN=$2 ;; --email) EMAIL=$2 ;;
        --tunnel-token) TUNNEL_TOKEN=$2 ;; --version) REL=$2 ;; --channel) CHANNEL=$2 ;;
      esac
      shift ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
  shift
done
case $MODE in ""|caddy|tunnel|local) ;; *) die "--mode must be caddy, tunnel or local" ;; esac
case $CHANNEL in latest|release) ;; *) die "--channel must be latest or release" ;; esac
case $REL in ""|v[0-9]*) ;; *) die "--version must look like v1.2.3" ;; esac
# These values end up in .env and the Caddyfile: refuse anything that could
# break out of a plain value (whitespace, quotes, $, backslash).
check_plain() {
  case $2 in
    *[[:space:]\"\'\$\\]*) die "$1 contains a space, quote, \$ or backslash, which is not allowed" ;;
  esac
}
check_plain --domain "$DOMAIN"; check_plain --email "$EMAIL"; check_plain --tunnel-token "$TUNNEL_TOKEN"

# --- 1. system checks --------------------------------------------------------
[ "$(uname -s)" = Linux ] || die "this installer supports Debian/Ubuntu Linux only"
[ -r /etc/os-release ] || die "cannot detect the OS (no /etc/os-release)"
# shellcheck disable=SC1091
. /etc/os-release
case ${ID:-} in
  debian|ubuntu) DOCKER_OS=$ID ;;
  *) case " ${ID_LIKE:-} " in
       *" ubuntu "*) DOCKER_OS=ubuntu ;;
       *" debian "*) DOCKER_OS=debian ;;
       *) die "unsupported OS '${ID:-unknown}'. This installer supports Debian and Ubuntu; for anything else follow https://famlin.app/docs/server-setup" ;;
     esac ;;
esac
CODENAME=${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}
[ -n "$CODENAME" ] || die "cannot detect the OS release codename"

if [ "$(id -u)" = 0 ]; then SUDO=""
elif command -v sudo >/dev/null 2>&1; then SUDO="sudo"
else die "run as root, or install sudo"; fi
command -v curl >/dev/null 2>&1 || { say "Installing curl"; run $SUDO apt-get update -qq; run $SUDO apt-get install -y -qq curl ca-certificates; }

# --- 2. Docker ---------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  say "Installing Docker from Docker's official apt repository"
  run $SUDO apt-get update -qq
  run $SUDO apt-get install -y -qq ca-certificates curl
  run $SUDO install -m 0755 -d /etc/apt/keyrings
  run $SUDO curl -fsSL "https://download.docker.com/linux/$DOCKER_OS/gpg" -o /etc/apt/keyrings/docker.asc
  run $SUDO chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$(dpkg --print-architecture)" "$DOCKER_OS" "$CODENAME" | write_file /etc/apt/sources.list.d/docker.list
  run $SUDO apt-get update -qq
  run $SUDO apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  run $SUDO systemctl enable --now docker
fi
if [ "$DRY_RUN" = 0 ]; then
  # The Caddy/Tunnel overlays use `!reset`, which needs Compose >= 2.24.
  cv=$(docker compose version --short 2>/dev/null || $SUDO docker compose version --short)
  [ -n "$cv" ] || die "cannot determine the Docker Compose version"
  cv=${cv#v}; major=${cv%%.*}; minor=${cv#*.}; minor=${minor%%.*}
  if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 24 ]; }; then
    die "Docker Compose $cv is too old (need 2.24+). Remove the distro's docker/compose packages and re-run to get Docker's own."
  fi
fi

# --- 3. download the release files -------------------------------------------
if [ -n "$REL" ]; then BASE="https://github.com/$REPO/releases/download/$REL"
else BASE="https://github.com/$REPO/releases/latest/download"; fi
say "Downloading Famlin ${REL:-(latest release)} into $DIR"
run $SUDO mkdir -p "$DIR"
if [ "$DRY_RUN" = 0 ]; then
  dl=$(mktemp -d)
  trap 'rm -rf "$dl"' EXIT
  # These are the release's own assets: the compose file defaults to that
  # release's image, the overlays add HTTPS. Your settings live in .env, so
  # these files are safe to overwrite on every run. Download everything first,
  # install after, so a failure never leaves a half-updated mix of versions.
  for f in docker-compose.yml docker-compose.caddy.yml docker-compose.tunnel.yml Caddyfile; do
    curl -fsSL "$BASE/$f" -o "$dl/$f" 2>/dev/null || die "could not download $BASE/$f
       If this release predates the installer (it does not carry the overlay files yet), try again after the next release, or pass --version vX.Y.Z of a newer release. Otherwise check '$REL' is a real release."
  done
  for f in docker-compose.yml docker-compose.caddy.yml docker-compose.tunnel.yml Caddyfile; do
    $SUDO install -m 644 "$dl/$f" "$DIR/$f"
  done
else
  printf '[dry-run] download %s/{docker-compose.yml,docker-compose.caddy.yml,docker-compose.tunnel.yml,Caddyfile}\n' "$BASE"
fi

# --- 4. access mode ----------------------------------------------------------
# Defaults come from an existing .env, so a re-run keeps your earlier answers.
[ -n "$MODE" ] || MODE=$(env_get FAMLIN_MODE)
if [ -z "$MODE" ]; then
  printf '\nHow should people reach Famlin?\n  caddy  - your own domain with automatic HTTPS (recommended)\n  tunnel - Cloudflare Tunnel (no open ports, domain on Cloudflare)\n  local  - plain http on port 3000 (home network / testing)\n\n' >&2
  ask "Access mode (caddy/tunnel/local)" "caddy"; MODE=$REPLY
fi
case $MODE in caddy|tunnel|local) ;; *) die "unknown mode '$MODE' (use caddy, tunnel or local)" ;; esac

COMPOSE_FILE="docker-compose.yml"
case $MODE in
  caddy)
    [ -n "$DOMAIN" ] || DOMAIN=$(env_get FAMLIN_DOMAIN)
    [ -n "$DOMAIN" ] || { ask "Domain name pointing at this server (e.g. famlin.example.com)" ""; DOMAIN=$REPLY; }
    check_plain domain "$DOMAIN"; check_plain email "$EMAIL"
    [ -n "$DOMAIN" ] || die "a domain is required for caddy mode (--domain)"
    [ -n "$EMAIL" ] || EMAIL=$(env_get ACME_EMAIL)
    [ -n "$EMAIL" ] || { ask "Email for Let's Encrypt expiry notices (optional)" ""; EMAIL=$REPLY; }
    # Warn (never block) if DNS does not point here yet: Let's Encrypt would fail.
    server_ip=$(curl -fsS https://api.ipify.org 2>/dev/null || true)
    domain_ip=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)
    if [ -z "$domain_ip" ]; then warn "$DOMAIN does not resolve yet. Create an A record for it pointing at ${server_ip:-this server}."
    elif [ -n "$server_ip" ] && [ "$domain_ip" != "$server_ip" ]; then
      warn "$DOMAIN resolves to $domain_ip but this server's public IP is $server_ip."
    fi
    if [ -n "$domain_ip" ] && [ -n "$server_ip" ] && [ "$domain_ip" != "$server_ip" ]; then
      ask "Continue anyway? (y/N)" "y"
      case $REPLY in y|Y|yes) ;; *) die "stopped; fix DNS and re-run" ;; esac
    fi
    COMPOSE_FILE="docker-compose.yml:docker-compose.caddy.yml"
    env_set FAMLIN_DOMAIN "$DOMAIN"
    [ -z "$EMAIL" ] || env_set ACME_EMAIL "$EMAIL" ;;
  tunnel)
    [ -n "$TUNNEL_TOKEN" ] || TUNNEL_TOKEN=$(env_get CLOUDFLARE_TUNNEL_TOKEN)
    [ -n "$TUNNEL_TOKEN" ] || { ask "Cloudflare tunnel token" ""; TUNNEL_TOKEN=$REPLY; }
    check_plain "tunnel token" "$TUNNEL_TOKEN"
    [ -n "$TUNNEL_TOKEN" ] || die "a tunnel token is required for tunnel mode (--tunnel-token)"
    COMPOSE_FILE="docker-compose.yml:docker-compose.tunnel.yml"
    env_set CLOUDFLARE_TUNNEL_TOKEN "$TUNNEL_TOKEN" ;;
esac
env_set FAMLIN_MODE "$MODE"
# With COMPOSE_FILE in .env, a plain `docker compose ...` in $DIR uses the right overlays.
env_set COMPOSE_FILE "$COMPOSE_FILE"
# Image tag: an explicit --version pins it; otherwise `latest` follows releases
# (what the update timer pulls), `release` keeps the downloaded release's tag.
if [ -n "$REL" ]; then env_set FAMLIN_VERSION "${REL#v}"
elif [ "$CHANNEL" = latest ]; then env_set FAMLIN_VERSION latest
fi

# --- 5. daily auto-update ----------------------------------------------------
if [ "$AUTO_UPDATE" = 1 ]; then
  if [ -d /run/systemd/system ] || [ "$DRY_RUN" = 1 ]; then
    say "Installing the daily update timer (famlin-update.timer)"
    DOCKER_BIN=$(command -v docker || echo /usr/bin/docker)
    write_file /etc/systemd/system/famlin-update.service <<UNIT
[Unit]
Description=Update Famlin (pull the image and restart if it changed)
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=$DIR
ExecStart=$DOCKER_BIN compose pull --quiet
ExecStart=$DOCKER_BIN compose up -d --remove-orphans
ExecStart=$DOCKER_BIN image prune -f
UNIT
    write_file /etc/systemd/system/famlin-update.timer <<UNIT
[Unit]
Description=Daily Famlin update

[Timer]
OnCalendar=daily
RandomizedDelaySec=2h
Persistent=true

[Install]
WantedBy=timers.target
UNIT
    run $SUDO systemctl daemon-reload
    run $SUDO systemctl enable --now famlin-update.timer
  else
    warn "systemd not found; skipping auto-updates. Update manually: cd $DIR && docker compose pull && docker compose up -d"
  fi
fi

# --- 6. start and wait -------------------------------------------------------
say "Starting Famlin (the first start downloads images and can take a few minutes)"
if [ "$DRY_RUN" = 1 ]; then printf '[dry-run] (cd %s && docker compose up -d --remove-orphans)\n' "$DIR"; else
  (cd "$DIR" && $SUDO docker compose pull --quiet && $SUDO docker compose up -d --remove-orphans)
  say "Waiting for the server to answer"
  ok=0 i=0
  while [ $i -lt 60 ]; do
    # The backend port is not published in caddy/tunnel mode, so ask from inside the container.
    if (cd "$DIR" && $SUDO docker compose exec -T famlin-backend wget -qO- http://127.0.0.1:3000/api/auth/setup-status) >/dev/null 2>&1; then ok=1; break; fi
    i=$((i + 1)); sleep 3
  done
  [ "$ok" = 1 ] || die "Famlin did not become ready in 3 minutes. Check: cd $DIR && docker compose logs famlin-backend"
fi

case $MODE in
  caddy)  URL="https://$DOMAIN" ;;
  tunnel) URL="your tunnel's public hostname (set in Cloudflare)" ;;
  *)      URL="http://$(hostname -I 2>/dev/null | awk '{print $1}'):3000" ;;
esac
printf '\nFamlin is running.\n\n  Open %s%s to create the first admin account.\n' "$URL" "$([ "$MODE" = tunnel ] || echo /admin)"
[ "$MODE" != tunnel ] || printf '  (Cloudflare: point the tunnel at http://famlin-backend:3000, then open /admin there.)\n'
[ "$MODE" != caddy ] || printf '  The certificate can take a minute on first visit; ports 80 and 443 must be open.\n'
printf '\n  Manage it:  cd %s && docker compose ps | logs -f | pull && docker compose up -d\n  Guide:      https://famlin.app/docs/install-vps\n' "$DIR"
}

main "$@"
