FROM node:22.23.0-alpine

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apk add --no-cache gcompat && corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @innovateats/workflows build

EXPOSE 3001
CMD ["pnpm", "--filter", "@innovateats/worker", "dev"]
