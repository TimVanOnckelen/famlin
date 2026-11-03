# Version of the published Famlin image to build on (see deploy/bump-version.sh).
ARG FAMLIN_VERSION=0.8.7
FROM ghcr.io/timvanonckelen/famlin:${FAMLIN_VERSION}

# This image runs as the unprivileged "node" user. The add-on needs root to
# prepare /data, then drops to "postgres" / "node" with su-exec.
USER root

# Bundled PostgreSQL 16 server (the image already ships the pg_dump client used
# by scheduled backups). jq reads the add-on options. The build fails if the
# server package is missing from the base image's Alpine release.
RUN apk add --no-cache postgresql16 su-exec jq \
    && postgres --version

COPY rootfs/ /
RUN chmod +x /run.sh

WORKDIR /app
ENTRYPOINT ["/run.sh"]

LABEL io.hass.name="Famlin" \
      io.hass.description="Private, self-hosted family updates" \
      io.hass.type="addon"
