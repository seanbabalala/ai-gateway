# ============================================================
# AI Gateway — Multi-stage Docker build
# ============================================================
# Produces a single image that serves the NestJS backend
# and the pre-built React frontend (via @nestjs/serve-static).
#
# Build:  docker build -t ai-gateway .
# Run:    docker run -p 2099:2099 -v $(pwd)/gateway.config.yaml:/app/gateway.config.yaml ai-gateway
# ============================================================

# ── Stage 1: Build frontend ──
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Build backend ──
FROM node:20-alpine AS backend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json nest-cli.json ./
COPY src/ ./src/
RUN npm run build

# ── Stage 3: Production image ──
FROM node:20-alpine AS production
WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built backend
COPY --from=backend-build /app/dist ./dist

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Create data directory for SQLite
RUN mkdir -p /app/data

# Default config (user should mount their own)
COPY gateway.config.example.yaml ./gateway.config.yaml

EXPOSE 2099

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:2099/health || exit 1

CMD ["node", "dist/main.js"]
