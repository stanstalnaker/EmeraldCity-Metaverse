# Emerald City web (hubculture.city). Build from the repo root:
#   docker build -f deploy/web.Dockerfile -t emerald-city-web .
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
# HubID isn't reachable at build time; pages that need it render at request time.
RUN HUBID_API_URL=http://127.0.0.1:9 pnpm --filter @emerald-city/web build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# Standalone output: a traced, self-contained server (apps/web/server.js) plus static assets.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/cities').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
