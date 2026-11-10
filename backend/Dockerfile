# Build context is the REPOSITORY ROOT (not backend/) — the member-facing web
# app (web/) and its shared package (packages/api-client) live outside
# backend/ but are bundled into this same image, so the context must span the
# whole repo. Build with:  docker build -f backend/Dockerfile .
# Build both frontends with the shared workspace packages and root lockfile.
# Admin, web and shared packages install together from the root workspace lockfile.
# Vite outputs land in /repo/backend/dist/{web,admin}.
FROM node:22-alpine AS webbuild

WORKDIR /repo

COPY package.json package-lock.json* ./
COPY packages ./packages
COPY web ./web
COPY backend/admin ./backend/admin
# --ignore-scripts is deliberate, for two reasons:
#
# 1. Reliability. npm 10's lifecycle-script runner has a race that intermittently
#    kills the install with "npm error Exit handler never called!" (exit 1) —
#    npm's own process exits before its exit handler runs. It shows up under
#    slow/loaded installs, so it fails a CI or cold-cache image build maybe one
#    run in three while passing locally on a warm cache. Skipping the script
#    runner removes the code path the race lives in; both `--ignore-scripts` and
#    `--foreground-scripts` avoid it, and the former also gets us (2).
# 2. Determinism. The only script that matters here is @famlin/api-client's
#    `prepare` hook, which compiles it to dist/ as an implicit side effect of
#    install (and silently falls back to the committed dist/ when tsc isn't
#    resolvable — see packages/api-client/scripts/prepare.js). Building it as an
#    explicit step means this image always bundles a dist/ compiled from the
#    source in this build context, never a stale committed one.
#
# Nothing else is skipped: fsevents is the only third-party dependency in the
# root lockfile with an install script, and it's darwin-only, so it is never
# installed here anyway. (The backend stages above/below must NOT do this —
# their trees need prisma's and esbuild's install scripts to run.)
RUN npm ci --ignore-scripts
RUN npm run build --workspace=packages/api-client
RUN npm run build --workspace=web
RUN npm run build --workspace=famlin-admin

FROM node:22-alpine AS base

WORKDIR /repo/backend

# OpenSSL for Prisma; ffmpeg for video poster-frame extraction
# (services/uploadVariants.ts) — needed here too because the dev overlay
# (docker-compose.override.yml) runs this `base` stage.
RUN apk add --no-cache openssl ffmpeg exiftool

# pg_dump for scheduled backups (services/backup/dbDump.ts). The newest
# postgresqlNN-client Alpine ships rather than one pinned to the compose
# file's postgres:16 — a newer pg_dump can dump older servers, which also
# covers self-hosters on an external Postgres 17+. `apk search` output differs
# between apk-tools 2 and 3 (name vs name-version), so only the name prefix is
# kept. The build fails here if no client got installed.
RUN PG_CLIENT=$(apk search -q 'postgresql*-client' | grep -oE '^postgresql[0-9]+-client' | sort -uV | tail -n1) \
    && test -n "$PG_CLIENT" \
    && apk add --no-cache "$PG_CLIENT" \
    && pg_dump --version

# Install dependencies
COPY backend/package.json backend/package-lock.json* backend/.npmrc ./
RUN npm ci

# Generate Prisma client
COPY backend/prisma ./prisma
# Prisma 7 reads the datasource connection string (and the schema path) from
# prisma.config.ts rather than from the schema's datasource block, so the CLI
# needs it here for `generate` and in the production stage for the
# `migrate deploy` this image runs at container start.
COPY backend/prisma.config.ts ./
RUN npx prisma generate

# Compile the backend independently; frontend assets come from webbuild below.
COPY backend/ ./
RUN npx tsc

# Compile the Prisma seed script so the production image can run it without
# tsx (which is a devDependency). Used by docker-compose.demo.yml to populate
# the demo instance on first start.
RUN npx tsc prisma/seed.ts --outDir dist/prisma \
    --module NodeNext --moduleResolution NodeNext --target ES2022 \
    --esModuleInterop --strict --skipLibCheck --resolveJsonModule

# Retain the workspace layout for the development target's admin watch-build.
# Copy after backend compilation so frontend changes keep backend layers cached.
COPY --from=webbuild /repo /repo

# Production image
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# OpenSSL for Prisma; ffmpeg for video poster-frame extraction
# (services/uploadVariants.ts).
RUN apk add --no-cache openssl ffmpeg exiftool

# pg_dump for scheduled backups (services/backup/dbDump.ts). The newest
# postgresqlNN-client Alpine ships rather than one pinned to the compose
# file's postgres:16 — a newer pg_dump can dump older servers, which also
# covers self-hosters on an external Postgres 17+. `apk search` output differs
# between apk-tools 2 and 3 (name vs name-version), so only the name prefix is
# kept. The build fails here if no client got installed.
RUN PG_CLIENT=$(apk search -q 'postgresql*-client' | grep -oE '^postgresql[0-9]+-client' | sort -uV | tail -n1) \
    && test -n "$PG_CLIENT" \
    && apk add --no-cache "$PG_CLIENT" \
    && pg_dump --version

COPY backend/package.json backend/package-lock.json* backend/.npmrc ./
# libvips is compiled from source here, at a pinned version, and sharp is then
# compiled against it. Two reasons it is neither sharp's prebuilt binary nor
# Alpine's `vips` package:
#
# - HEIC/HEIF (the default iPhone camera format): sharp's prebuilt binaries
#   deliberately ship without the patent-encumbered HEVC decoder, so they
#   can't read .heic at all.
# - Security updates: libvips decodes every photo a member uploads. Alpine's
#   package lags upstream (3.24 ships 8.18.2), which kept sharp pinned to an
#   old release and the image on a libvips with known CVEs
#   (GHSA-f88m-g3jw-g9cj). Owning the version means a fix is a one-line bump.
#
# To update libvips: change VIPS_VERSION and VIPS_SHA256 (sha256sum of the
# vips-<version>.tar.xz release asset on github.com/libvips/libvips). It must
# satisfy the `config.libvips` range in sharp's package.json — the sharp build
# below fails with a clear message when it doesn't, so a sharp bump that needs
# a newer libvips can't silently fall back to the no-HEIC prebuilt.
#
# Only the loaders Famlin uses are built (JPEG, PNG, WebP, HEIC/AVIF via
# libheif, GIF via the built-in nsgif) plus ICC/EXIF handling and SIMD.
# Everything else stays off on purpose (--auto-features=disabled): SVG, PDF,
# TIFF, ImageMagick and friends are parsers this server never needs, and each
# is attack surface for a crafted upload.
ARG VIPS_VERSION=8.18.7
ARG VIPS_SHA256=5baaead3b0bb20ffdb9e9ff09aa9fda08620923df77b63b436654cb5e0b3bf94
# Headers of the libraries libvips links against. Needed again when sharp is
# compiled: pkg-config resolves vips-cpp's private requirements too.
ARG VIPS_DEV_DEPS="glib-dev expat-dev libjpeg-turbo-dev libpng-dev libwebp-dev libheif-dev lcms2-dev libexif-dev highway-dev zlib-dev"

# The runtime libraries are not listed by hand: scanelf reads which shared
# objects the freshly built libvips actually needs, and those are installed as
# the .vips-rundeps group so `apk del .vips-build-deps` can't take them along.
RUN apk add --no-cache --virtual .vips-build-deps build-base meson pkgconf $VIPS_DEV_DEPS \
    && wget -q -O /tmp/vips.tar.xz \
       "https://github.com/libvips/libvips/releases/download/v${VIPS_VERSION}/vips-${VIPS_VERSION}.tar.xz" \
    && echo "${VIPS_SHA256}  /tmp/vips.tar.xz" | sha256sum -c - \
    && mkdir /tmp/vips && tar -xJf /tmp/vips.tar.xz -C /tmp/vips --strip-components=1 \
    && cd /tmp/vips \
    && meson setup build --prefix=/usr/local --libdir=lib --buildtype=release \
       --auto-features=disabled \
       -Dexamples=false -Dcpp-docs=false -Ddocs=false \
       -Djpeg=enabled -Dpng=enabled -Dwebp=enabled -Dheif=enabled \
       -Dlcms=enabled -Dexif=enabled -Dzlib=enabled -Dhighway=enabled \
    && meson compile -C build \
    && meson install -C build \
    && cd / && rm -rf /tmp/vips /tmp/vips.tar.xz \
    && apk add --no-cache --virtual .vips-rundeps $( \
         scanelf --needed --nobanner --format '%n#p' --recursive /usr/local/lib \
           | tr ',' '\n' | sort -u \
           | awk 'system("[ -e /usr/local/lib/" $1 " ]") == 0 { next } { print "so:" $1 }' \
       ) \
    && apk del .vips-build-deps

# sharp >= 0.35 has no install script any more, so `npm ci` only fetches the
# prebuilt binary; the from-source build is the explicit build.js step. It
# needs node-addon-api and node-gyp, installed into a throwaway prefix (not
# the app's dependency tree) and exposed via NODE_PATH/PATH.
#
# Guards against a silent fallback to the no-HEIC prebuilt, in order: the
# libvips version check before compiling, removing the prebuilt @img/sharp-*
# packages afterwards (sharp then has nothing else to load), and the HEIC
# check, which runs after the build tools are gone so it also catches a
# runtime library going missing.
RUN apk add --no-cache --virtual .build-deps build-base python3 pkgconf $VIPS_DEV_DEPS \
    && npm install --prefix /tmp/sharp-build --no-save --no-audit --no-fund node-addon-api node-gyp \
    && export PKG_CONFIG_PATH=/usr/local/lib/pkgconfig \
    && npm ci --omit=dev \
    && node -e "const l=require('./node_modules/sharp/dist/libvips.cjs'); if(!l.useGlobalLibvips()){console.error('libvips '+(l.globalLibvipsVersion()||'(not found)')+' does not satisfy sharp, which needs '+l.minimumLibvipsVersion+' or newer: bump VIPS_VERSION in backend/Dockerfile');process.exit(1)}" \
    && (cd node_modules/sharp \
        && NODE_PATH=/tmp/sharp-build/node_modules PATH="/tmp/sharp-build/node_modules/.bin:$PATH" \
           node install/build.js) \
    && rm -rf node_modules/@img/sharp-linux* node_modules/@img/sharp-libvips-linux* \
              node_modules/sharp/src/build/Release/obj.target /tmp/sharp-build /root/.cache/node-gyp \
    && apk del .build-deps
RUN node -e "const s=require('sharp'); if(!(s.format.heif.input.fileSuffix||[]).includes('.heic')) { console.error('sharp built without HEIC support'); process.exit(1); } console.log('sharp', s.versions.sharp, 'libvips', s.versions.vips);"

COPY --from=base /repo/backend/node_modules/.prisma ./node_modules/.prisma
COPY --from=base /repo/backend/dist ./dist
COPY --from=base /repo/backend/prisma ./prisma
COPY --from=base /repo/backend/prisma.config.ts ./
COPY --from=base /repo/backend/dist/prisma ./dist/prisma
COPY --from=webbuild /repo/backend/dist/web ./dist/web
COPY --from=webbuild /repo/backend/dist/admin ./dist/admin

# Create the uploads, backups and data directories with proper permissions and
# run as the unprivileged `node` user rather than root. All are volume mount
# points (docker-compose.yml); a named volume copies this ownership on first
# use. /app/data holds the generated JWT secret.
RUN mkdir -p /app/uploads /app/backups /app/data && chown -R node:node /app

USER node

EXPOSE 3000

# src/boot.ts runs the downgrade guard (refuses to start against a database
# migrated by a newer release), then `prisma migrate deploy`, then the server
# — in one node process started directly (exec form, no shell), so node is
# PID 1 and receives docker stop's SIGTERM to shut down gracefully
# (src/server.ts); a shell as PID 1 doesn't forward signals.
CMD ["node", "dist/boot.js"]
