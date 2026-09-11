# Saylent — the OWN-SERVER run target: "your own server + database". Multi-stage
# build of the Next.js app on Node 22,
# using Next's standalone output so the runtime image carries only the traced
# files instead of the whole node_modules tree
# (node_modules/next/dist/docs/.../output.md).
#
# Supabase is NOT in this image. Bring your own project (hosted free tier, or the
# self-hosted Supabase compose — the advanced path) and pass its URL + keys in.
# Jobs run in the companion self-hosted Inngest container (docker-compose.yml).
#
# Build:  docker build -t saylent-app .
# Run:    docker compose up -d      (see docker-compose.yml)

# ---------- 1. deps: install once, cached on the lockfile ----------
FROM node:22-alpine AS deps
# next/image's sharp needs the glibc shim on Alpine; harmless otherwise.
RUN apk add --no-cache libc6-compat
WORKDIR /app
# npm workspaces: every workspace manifest must be present for `npm ci` to build
# the same tree the lockfile describes.
COPY package.json package-lock.json ./
COPY packages/cli/package.json ./packages/cli/
COPY packages/engine/package.json ./packages/engine/
COPY packages/report/package.json ./packages/report/
# devDependencies are required to BUILD (typescript, tailwind, the Sentry plugin).
RUN npm ci

# ---------- 2. builder: next build → .next/standalone ----------
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined into the browser bundle at BUILD time, so they
# are build args, not runtime env. Everything else (Supabase service key, provider
# keys, Inngest keys) is read at runtime and must NOT be baked in.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_CONTACT_EMAIL
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_PUBLIC_CONTACT_EMAIL=$NEXT_PUBLIC_CONTACT_EMAIL \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN

# The image must build without any secret: src/lib/env.ts validates the full
# manifest at import time and CI uses the same escape hatch.
# NEXT_OUTPUT_STANDALONE is read by next.config.ts, so a Vercel build (which does
# not set it) stays byte-for-byte what it is today.
ENV SKIP_ENV_VALIDATION=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    NEXT_OUTPUT_STANDALONE=1
RUN npm run build

# ---------- 3. runner: the standalone server, non-root ----------
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Never run the server as root.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# server.js does not serve `public` or `.next/static` itself — they are copied in
# next to it, which is what makes the minimal server serve them (output.md).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# /api/health is the same probe UptimeRobot uses: 200 when
# the app can reach Postgres, 503 when it cannot — so an unhealthy container here
# means "app up, database unreachable", which is exactly what you want to see.
# wget is busybox's, already in the base image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q --spider "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "server.js"]
