# syntax=docker/dockerfile:1.7

FROM node:22.23.0-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

RUN apk add --no-cache gcompat \
  && corepack enable

WORKDIR /app

FROM base AS builder
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile
ENV NODE_ENV=production
ENV APP_URL=https://crm.invalid
ENV DATABASE_URL=postgresql://ci:ci@database.invalid:5432/ci?sslmode=require
ENV BETTER_AUTH_SECRET=container-build-only-secret-with-at-least-thirty-two-characters
ENV AUTHORIZED_EMAIL=maateosanchezt@gmail.com
ENV GLOBAL_DRY_RUN=true
ENV EMAIL_SEND_ENABLED=false
ENV AUTONOMOUS_SEND_ENABLED=false
RUN pnpm exec turbo run build --filter=@innovateats/web...

FROM node:22.23.0-alpine AS web-runtime
RUN apk add --no-cache gcompat \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
