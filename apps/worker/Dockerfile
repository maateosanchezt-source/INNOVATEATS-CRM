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
RUN pnpm exec turbo run build --filter=@innovateats/worker...

FROM builder AS production-dependencies
RUN pnpm install --prod --frozen-lockfile --offline

FROM base AS worker-runtime
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 worker
COPY --from=production-dependencies --chown=worker:nodejs /app /app
USER worker
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health >/dev/null || exit 1
CMD ["node", "apps/worker/dist/index.js"]
