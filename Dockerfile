# Production image for Next.js 15 App Router (standalone output).
FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* build args are safe to embed — they're already browser-exposed at runtime.
ARG NEXT_PUBLIC_BASE_PATH=/creole-knowledge-portal
ARG NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder-anon-key
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
# Server-only secrets are passed only to this single RUN step's process env —
# never as ARG/ENV — so no secret-shaped value is ever persisted as an image
# layer or visible via `docker history`/`docker inspect`. `next build` only
# needs these vars to be present, not real; actual values are injected at
# ECS runtime via task env/Secrets Manager.
RUN NODE_OPTIONS="--max-old-space-size=4096" \
    SUPABASE_SERVICE_ROLE_KEY=build-time-placeholder-not-a-secret \
    GEMINI_API_KEY=build-time-placeholder-not-a-secret \
    npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
