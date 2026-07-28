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
