FROM node:24-alpine AS dependencies

RUN corepack enable
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json prisma.config.ts ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY prisma ./prisma
COPY apps ./apps
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build pnpm exec prisma generate
RUN pnpm --filter @warehouse/api build
ARG VITE_API_BASE_URL=""
RUN test -z "$VITE_API_BASE_URL" && VITE_API_BASE_URL="" pnpm --filter @warehouse/web build

FROM build AS migrate

CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec prisma db seed"]

FROM caddy:2.10-alpine AS web-runtime

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /workspace/apps/web/dist /srv

FROM build AS api-package

RUN pnpm --filter @warehouse/api deploy --prod --no-optional /opt/api \
    && build_client="$(readlink -f /workspace/node_modules/@prisma/client)" \
    && runtime_client="$(readlink -f /opt/api/node_modules/@prisma/client)" \
    && build_modules="$(dirname "$(dirname "$build_client")")" \
    && runtime_modules="$(dirname "$(dirname "$runtime_client")")" \
    && cp -a "$build_modules/.prisma" "$runtime_modules/.prisma" \
    && rm -rf /opt/api/src /opt/api/tsconfig.json /opt/api/tsconfig.tsbuildinfo

FROM node:24-alpine AS api-runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=api-package --chown=node:node /opt/api/ ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
