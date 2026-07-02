FROM node:20-alpine AS base

WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Generate Prisma client
COPY prisma ./prisma
RUN npx prisma generate

# Copy source and build
COPY . .
RUN npm run build

# Production image
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=base /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=base /app/dist ./dist
COPY --from=base /app/prisma ./prisma

# Create uploads directory with proper permissions and run as the
# unprivileged `node` user rather than root.
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
