# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Dependencies (full, including dev — next/typescript/tailwind are build-only)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ─────────────────────────────────────────────────────────────────────────────
# Build
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# ── Build-time public config ────────────────────────────────────────────────
# These are ARGs, not runtime env, and the distinction is not cosmetic: `next
# build` INLINES every NEXT_PUBLIC_* value into the client bundle as a literal.
# Nothing re-reads them afterwards, so setting them in Compose's
# `environment:` block has no effect whatsoever — the bundle keeps whatever it
# was built with.
#
# Getting this wrong is silent and total: the app ships with the dev fallback
# ws://localhost:3001/ws baked in, every visitor's browser opens a socket to
# its own machine, and the price stream simply never connects with no error
# naming the cause. next.config.js fails the production build rather than let
# that out — so a missing NEXT_PUBLIC_HL_WS_URL breaks THIS DOCKER BUILD by
# design. That is the guard working, not a bug; set the value in the root .env.
ARG NEXT_PUBLIC_HL_WS_URL
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ARG BACKEND_URL=http://backend:3001
ENV NEXT_PUBLIC_HL_WS_URL=$NEXT_PUBLIC_HL_WS_URL
ENV NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ENV BACKEND_URL=$BACKEND_URL

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# The repo has no public/ directory today. Next's standalone output does not
# create one either, so the runtime COPY below would fail the build the moment
# it is missing — create it here so the image builds whether or not static
# assets have been added since.
RUN mkdir -p public && npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Runtime
#
# `output: 'standalone'` (next.config.js) emits a self-contained server plus
# only the node_modules it actually traced, so this stage never runs npm and
# carries no build toolchain.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002
# server.js binds 127.0.0.1 by default, which inside a container means "nothing
# outside this container can reach it" — nginx would get connection refused.
ENV HOSTNAME=0.0.0.0

# Compose also supplies BACKEND_URL at runtime. Next serializes the rewrite
# destinations during `next build`, however, so the builder receives it as an
# ARG above as well; otherwise the image retains the localhost fallback.

# next.config.js pins outputFileTracingRoot to the frontend directory, so the
# entrypoint is a predictable .next/standalone/server.js. Without that pin the
# repo-root lockfile would push it to .next/standalone/frontend/server.js and
# this CMD would break.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
