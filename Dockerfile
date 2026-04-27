# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (including devDependencies for build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Build: compiles TypeScript server → dist/index.cjs + vite client → dist/public
RUN npm run build

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Cloud Run requires the app to listen on $PORT (default 8080)
# server/index.ts already reads: parseInt(process.env.PORT || "5000")
EXPOSE 8080

# Start production server
CMD ["node", "dist/index.cjs"]
