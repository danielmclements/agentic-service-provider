FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json tsconfig.base.json vitest.config.ts ./
COPY apps ./apps
COPY services ./services
COPY agents ./agents
COPY integrations ./integrations
COPY shared ./shared
COPY prisma ./prisma
COPY evals ./evals

RUN pnpm install --frozen-lockfile
RUN pnpm prisma generate

CMD ["pnpm", "tsx", "apps/worker/src/index.ts"]
