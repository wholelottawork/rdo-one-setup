# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Dependencies
#
# The backend has no build step: it is "type": "module" TypeScript executed
# directly by tsx. That only works with --omit=dev because tsx lives in
# `dependencies`, not `devDependencies` — if it is ever moved back, this image
# builds fine and then crashes on start with "Cannot find package 'tsx'".
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Copied alone so this layer is only invalidated by a dependency change, not by
# every source edit.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ─────────────────────────────────────────────────────────────────────────────
# Runtime
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# The image ships the code and nothing else. Secrets arrive at run time via
# env_file; .env is excluded by .dockerignore so it cannot be baked in even by
# accident, which matters because AGENT_KEY_ENCRYPTION_SECRET decrypts every
# stored user agent key.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src

# `node` (uid 1000) ships with the base image. Nothing here is written at run
# time, so the whole tree can stay owned by root and read-only to the app user.
USER node

EXPOSE 3001

# Polls the app's own /health, which returns 503 when Redis is down. That is a
# deliberate status signal, not a restart trigger: the backend is designed to
# survive Redis being gone and recover when it returns, so `restart:
# unless-stopped` (which only acts on process exit) must be the only restart
# policy in play. Compose is told service_started, never service_healthy, for
# anything that depends on this container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Deliberately NOT `npm start`. npm runs the real process as a child and does
# not forward SIGTERM to it, so `docker compose down` would hit the 10s kill
# timeout and SIGKILL the app — skipping the graceful shutdown in src/index.ts
# that quits Redis and releases the TP/SL watcher's 30s lock. `node --import
# tsx` runs the app as PID 1 itself, so the signal reaches its own handler.
CMD ["node", "--import", "tsx", "src/index.ts"]
