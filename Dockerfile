# Cameron's app image. Multi-stage so the runtime carries the standalone server and nothing else —
# no pnpm, no dev dependencies, no source.
#
# Built by the `web` and `migrate` services in compose.yaml (`--profile full`). Contributors run the
# app on the host and never build this.

# ── deps ─────────────────────────────────────────────────────────────────────────────────────────
# Separate from the build stage so a source-only change reuses the cached install layer.
FROM node:24-alpine AS deps
WORKDIR /app

RUN corepack enable

# Only the manifests, so this layer busts on a dependency change rather than on every edit.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ── build ────────────────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `next build` runs the app's own code (route modules are evaluated to collect metadata), and
# s3-client.ts throws at module load when these are unset. They are build-time placeholders only —
# the real values arrive at run time from compose.
ENV S3_ACCESS_KEY_ID=build-placeholder \
    S3_SECRET_ACCESS_KEY=build-placeholder \
    NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

# ── migrate ──────────────────────────────────────────────────────────────────────────────────────
# drizzle-kit is a devDependency and is deliberately absent from the runtime image, so migrations
# run from their own stage. compose gates `web` on this completing successfully.
FROM node:24-alpine AS migrate
WORKDIR /app

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src/lib/database ./src/lib/database

CMD ["pnpm", "exec", "drizzle-kit", "migrate"]

# ── runtime ──────────────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    HOSTNAME=0.0.0.0

# Don't run as root.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# `standalone` omits these by design — they are served from disk, not traced as imports. The
# skills are read from disk at startup, so without this COPY the image runs with zero skills and
# says nothing about it.
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/skills ./skills
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# 3100, not 3000 — chosen so Cameron and the starter template can run side by side.
EXPOSE 3100

CMD ["node", "server.js"]
