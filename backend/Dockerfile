# Build context is the REPOSITORY ROOT (not backend/) — the member-facing web
# app (web/) and its shared package (packages/api-client) live outside
# backend/ but are bundled into this same image, so the context must span the
# whole repo. Build with:  docker build -f backend/Dockerfile .
FROM node:22-alpine AS base

WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

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
COPY packages /packages

# Copy source and build (backend + admin UI -> dist/, dist/admin)
COPY backend/ ./
RUN npm run build

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

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=base /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=base /app/dist ./dist
COPY --from=base /app/prisma ./prisma
COPY --from=webbuild /repo/backend/dist/web ./dist/web

# Create uploads directory with proper permissions and run as the
# unprivileged `node` user rather than root.
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
