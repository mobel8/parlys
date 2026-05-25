# ────────────────────────────────────────────────────────────────────
#  VoiceInk backend — multi-stage Docker build
#
#  - Stage 1 (builder) installs dev deps + compiles TypeScript.
#  - Stage 2 (runtime) keeps only prod deps + compiled dist/.
#
#  Final image: ~150 MB (node:22-alpine base + pruned node_modules).
#  Build: `docker build -t voiceink-server -f server/Dockerfile server`
#  Run:   `docker run --env-file server/.env -p 8787:8787 voiceink-server`
# ────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS builder
WORKDIR /app
# Copy manifest first so `npm ci` is cached across source-only changes.
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Drop dev deps.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund
COPY --from=builder /app/dist ./dist
# Non-root user — a compromised process can't rewrite /app.
RUN addgroup -S app && adduser -S -G app app && chown -R app:app /app
USER app
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --spider -q http://127.0.0.1:8787/health || exit 1
CMD ["node", "dist/server.js"]
