FROM node:22.23.0-alpine

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

EXPOSE 3000
CMD ["pnpm", "--filter", "@innovateats/web", "dev"]
