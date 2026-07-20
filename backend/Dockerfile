# Build context is the REPOSITORY ROOT (not backend/) — the member-facing web
# app (web/) and its shared package (packages/api-client) live outside
# backend/ but are bundled into this same image, so the context must span the
# whole repo. Build with:  docker build -f backend/Dockerfile .
FROM node:22-alpine AS base

WORKDIR /app

# OpenSSL for Prisma; ffmpeg for video poster-frame extraction
# (services/uploadVariants.ts) — needed here too because the dev overlay
# (docker-compose.override.yml) runs this `base` stage.
RUN apk add --no-cache openssl ffmpeg

# Install dependencies
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci

# Generate Prisma client
COPY backend/prisma ./prisma
RUN npx prisma generate

# The admin UI depends on the shared api-client via file:../../packages/api-client
# (see backend/admin/package.json). /app holds backend/, so that path resolves to
# /packages/api-client — copy it there for the `npm ci` that `npm run build` runs
# inside admin/. Its committed dist/ is used as-is (same pattern as mobile's
# file: dependency; no build step needed).
#
# /packages/api-client has no lockfile of its own (it normally relies on the
# root workspace's), and sits outside admin's node_modules tree entirely, so
# without its own node_modules here, admin's `vite build` can't resolve the
# runtime deps its compiled dist/*.js files `require()` (axios, at least) —
# Rollup silently leaves those as unresolved external imports instead of
# failing the build, which breaks the shipped bundle at runtime in the
# browser ("Failed to resolve module specifier axios") rather than at build
# time. Give it its own node_modules so those resolve locally.
COPY packages /packages
RUN cd /packages/api-client && npm install --omit=dev --no-audit --no-fund

# Copy source and build (backend + admin UI -> dist/, dist/admin)
COPY backend/ ./
RUN npm run build

# Compile the Prisma seed script so the production image can run it without
# tsx (which is a devDependency). Used by docker-compose.demo.yml to populate
# the demo instance on first start.
RUN npx tsc prisma/seed.ts --outDir dist/prisma \
    --module NodeNext --moduleResolution NodeNext --target ES2022 \
    --esModuleInterop --strict --skipLibCheck --resolveJsonModule

# Build the member-facing web app in its own stage: it's an npm-workspace
# member at the repo root together with packages/api-client, so it installs
# from the root lockfile, not backend's. Its vite outDir is
# ../backend/dist/web, which lands at /repo/backend/dist/web here.
FROM node:22-alpine AS webbuild

WORKDIR /repo

COPY package.json package-lock.json* ./
COPY packages ./packages
COPY web ./web
RUN npm ci
RUN npm run build --workspace=web

# Production image
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# OpenSSL for Prisma; ffmpeg for video poster-frame extraction
# (services/uploadVariants.ts).
RUN apk add --no-cache openssl ffmpeg

COPY backend/package.json backend/package-lock.json* ./
# vips/vips-heif give sharp real HEIC/HEIF decode support (the default iPhone
# camera format) — sharp's own prebuilt binaries deliberately ship without it
# (patent-encumbered HEVC decoder). Installing build tooling as a named
# virtual package lets `npm ci` compile sharp against the system libvips
# instead of downloading its no-HEIF prebuilt binary; deleting just that
# virtual group afterward keeps the compiled addon working (it dynamically
# links against the vips/vips-heif runtime libs, which stay installed) without
# leaving compilers in the final image.
RUN apk add --no-cache vips vips-heif
RUN apk add --no-cache --virtual .build-deps build-base python3 pkgconfig vips-dev \
    && npm ci --omit=dev \
    && apk del .build-deps

COPY --from=base /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=base /app/dist ./dist
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/dist/prisma ./dist/prisma
COPY --from=webbuild /repo/backend/dist/web ./dist/web

# Create uploads directory with proper permissions and run as the
# unprivileged `node` user rather than root.
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
