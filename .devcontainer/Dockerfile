FROM node:20

RUN apt-get update \
  && apt-get install -y --no-install-recommends git curl ca-certificates vim \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9 --activate

ENV NODE_ENV=development
WORKDIR /workspace