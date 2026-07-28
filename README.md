# MediaDeck – Project Handoff

MediaDeck is a self-hosted, controller-first media browser designed for a
headless Linux Docker host. Firefox is the browser engine, not the product.

## Vision

MediaDeck is a self-hosted Docker application that provides a controller-first,
touch-friendly browser appliance for YouTube. Firefox is the browser engine,
not the product.

Initial deployment target:

- Docker Compose
- HTTPS over Tailscale
- Any modern browser as the client

Development philosophy:

- Build a polished appliance, not a remote desktop.
- Keep v1 focused on YouTube.
- Architect for future media apps.

## Current Status

Stage 1 establishes the production repository foundation:

- React, TypeScript, Vite, and Tailwind CSS frontend
- Fastify backend
- Runtime-validated configuration
- Shared API contracts
- Persistent storage layout
- Local and Docker development
- Hardened production container
- Automated quality checks and CI

Firefox streaming begins in Stage 2.

## Quick Start

```shell
pnpm install
pnpm dev
```

Open `http://localhost:5173`.

Run all quality gates with:

```shell
pnpm validate
```

## Project Documents

- [Product specification](docs/product-spec.md)
- [Architecture](docs/architecture.md)
- [Architecture decisions](docs/architecture-decisions.md)
- [Implementation plan](docs/implementation-plan.md)
- [Roadmap](docs/roadmap.md)
- [Development guide](docs/development.md)
- [Deployment guide](docs/deployment.md)
