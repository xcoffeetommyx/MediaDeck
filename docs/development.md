# Development

## Requirements

- Node.js 24.14
- pnpm 11.9
- Docker Engine with Docker Compose

The versions are pinned in `.node-version` and the root `package.json`.

## Local Development

Install dependencies:

```shell
pnpm install
```

Run the API and web application with live reload:

```shell
pnpm dev
```

Open `http://localhost:5173`. Vite proxies API calls to
`http://127.0.0.1:3000`.

Local API data is stored in `.data/` and is ignored by Git.

## Docker Development

Build and run both development services:

```shell
docker compose -f compose.dev.yaml up --build
```

Open `http://localhost:5173`. Source directories are mounted for live reload.
Rebuild the images after changing dependencies or build configuration.

## Browser Transport Spike

Run the production application and the pinned Firefox/Selkies worker:

```shell
docker compose -f compose.yaml -f compose.browser-spike.yaml up --build -d
```

The MediaDeck application is available at `http://127.0.0.1:8080`. The spike
exposes the browser transport at `http://127.0.0.1:3002` and its self-signed
HTTPS endpoint at `https://127.0.0.1:3003`. These bindings are deliberately
loopback-only.

Check the transport-neutral worker status:

```shell
curl http://127.0.0.1:8080/api/v1/browser-worker/health
```

Override `BROWSER_START_URL`, ports, and encoding settings in `.env`. The
default software encoder is the supported baseline.

On a Linux Intel/AMD host, the optional VA-API experiment can be added with:

```shell
docker compose -f compose.yaml -f compose.browser-spike.yaml -f compose.browser-gpu.yaml up --build -d
```

Do not use the GPU override until `BROWSER_DRI_DEVICE` has been verified on the
host.

## Quality Checks

Run the complete local validation suite:

```shell
pnpm validate
```

Individual commands are available for formatting, linting, type checking,
tests, coverage, and production builds:

```shell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
```

## Workspace Layout

```text
apps/
  api/          Fastify HTTP service and storage initialization
  web/          React/Vite client
packages/
  config/       Runtime-validated server configuration
  contracts/    Shared API schemas and TypeScript types
docs/           Product, architecture, and operator documentation
```

Application code depends on workspace packages through the
`@mediadeck/*` namespace. Shared packages compile before their consumers.
