# syntax=docker/dockerfile:1.18

FROM node:24.14.0-alpine AS tooling

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM tooling AS development

COPY . .

CMD ["pnpm", "dev"]

FROM tooling AS build

COPY . .

RUN pnpm build
RUN pnpm --filter @mediadeck/api deploy --prod /opt/mediadeck

FROM node:24.14.0-alpine AS runtime

ENV APP_VERSION=0.1.0
ENV DATA_DIR=/data
ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3000
ENV PUBLIC_DIR=/app/public

WORKDIR /app

RUN mkdir -p /app/public /data && chown -R node:node /app /data

COPY --chown=node:node --from=build /opt/mediadeck/ ./
COPY --chown=node:node --from=build /workspace/apps/web/dist/ ./public/

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/index.js"]
