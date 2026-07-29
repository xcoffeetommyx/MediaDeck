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

## Profile-Aware Session Workers

Production creates a pinned Brave Origin worker for each individual session:

```shell
docker compose -f compose.yaml -f compose.sessions.yaml up --build -d
```

On Linux, set `DOCKER_GID` in `.env` to the group that owns the Docker socket:

```shell
stat -c '%g' /var/run/docker.sock
```

The default capacity is one active session. Raising
`MAX_BROWSER_SESSIONS` exercises the multi-profile architecture but does not
make Stage 7's client routing and host capacity work complete.

Useful API calls:

```shell
curl http://127.0.0.1:8080/api/v1/profiles
curl http://127.0.0.1:8080/api/v1/sessions
curl http://127.0.0.1:8080/api/v1/browser-worker/health
```

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
