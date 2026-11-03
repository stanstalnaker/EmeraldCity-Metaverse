# Emerald City backend services: presence (WebSocket) and the Zeke host / voice worker.
# One image, the command picks the service (see deploy/docker-compose.yml). Build from the repo root:
#   docker build -f deploy/services.Dockerfile -t emerald-city-services .
FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @emerald-city/presence --filter @emerald-city/zeke-host typecheck
ENV NODE_ENV=production
USER node
EXPOSE 8787
# Run services with tsx directly, not via pnpm: corepack would try to download pnpm at start-up
# for the unprivileged user (needs network at boot, and fails offline).
CMD ["apps/presence/node_modules/.bin/tsx", "apps/presence/src/main.ts"]
