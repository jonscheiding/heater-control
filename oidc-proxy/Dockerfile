# Portable image for the ScheduleMaster OIDC proxy.
# Build from the REPO ROOT so the pnpm workspace is available:
#   docker build -f oidc-proxy/Dockerfile -t sm-oidc-proxy .
#
# Runs anywhere that runs a container (Fly.io, Railway, a box beside HA, etc.);
# configure entirely via the env vars in .env.example.

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app

# Install deps for the proxy and its workspace dep (sm-client) from the lockfile.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY sm-client/package.json sm-client/package.json
COPY oidc-proxy/package.json oidc-proxy/package.json
COPY web/package.json web/package.json
RUN pnpm install --frozen-lockfile --filter @heater-control/oidc-proxy...

COPY . .
RUN pnpm --filter @heater-control/oidc-proxy... build
# Produce a self-contained deploy bundle (built files + prod node_modules).
RUN pnpm --filter @heater-control/oidc-proxy deploy --prod /out

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
EXPOSE 3000
CMD ["node", "dist/server.js"]
