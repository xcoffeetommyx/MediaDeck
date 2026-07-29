# MediaDeck – Project Handoff

MediaDeck is a self-hosted, controller-first media browser designed for a
headless Linux Docker host. Brave Origin is the browser engine, not the product.

## Vision

MediaDeck is a self-hosted Docker application that provides a controller-first,
touch-friendly browser appliance for YouTube. Brave Origin is the browser engine,
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

Stages 1 through 8 establish:

- React, TypeScript, Vite, and Tailwind CSS frontend
- Fastify backend
- Runtime-validated configuration
- Shared API contracts
- Persistent storage layout
- Local and Docker development
- Hardened production container
- Automated quality checks and CI
- A pinned Brave Origin/Selkies browser worker
- YouTube video, audio, input, and reconnect validation
- A transport-neutral browser-worker health API
- Persistent profile CRUD backed by SQLite
- Ephemeral Guest sessions with automatic cleanup
- Profile locks, idle shutdown, health monitoring, and crash recovery
- Docker workers keyed by opaque session IDs
- A Compose-built, digest-pinned Brave Origin worker image
- Automatic Intel/AMD DRI hardware encoding with safe software fallback
- Four administrator-selectable 30/60 FPS stream-quality presets
- Administrator-selectable 1080p, 720p, and 480p session resolutions
- A profile picker backed by the persistent profile API
- A temporary Guest path and in-app profile creation
- A controller-first home screen with operational Settings and Updates
- Spatial focus navigation for gamepad, keyboard, mouse, and touch
- Responsive TV, tablet, desktop, and phone layouts
- Automated interaction and accessibility checks
- A first-class YouTube application definition
- Opaque per-session HTTP and WebSocket stream routing
- A chromeless Brave Origin app viewer with video, audio, reload, and fullscreen controls
- A touch-only native mobile keyboard control for remote text fields
- Heartbeat, resume, recovery, and explicit return behavior
- Persistent profile sessions and temporary Guest cleanup through the visible UI
- Optional administrator PIN protection with expiring unlock sessions
- System diagnostics, a persistent operations log, and recovery reconciliation
- Consistent SQLite/profile backups and restart-applied restores
- HTTPS manifest checks and digest-pinned, backup-first update approval
- A headless Linux and private Tailscale Serve operations runbook
- Concurrent workers for different profiles with bounded host capacity
- Per-session API, HTTP stream, and WebSocket authorization
- Per-worker CPU, memory, PID, GPU-mode, and bandwidth observability
- Multi-session failure isolation and independent crash recovery
- Separate persistent Brave Origin profiles and temporary Guest storage
- Optional AV1 prevention for older hardware
- Broadwell-compatible i965 plus newer Intel iHD VA-API drivers
- Per-profile Chrome Web Store extension management
- Administrator-protected install, enable/disable, and removal controls

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

Run the production profile-aware worker manager with:

```shell
docker compose -f compose.yaml -f compose.sessions.yaml up --build -d
```

## Project Documents

- [Product specification](docs/product-spec.md)
- [Architecture](docs/architecture.md)
- [Architecture decisions](docs/architecture-decisions.md)
- [Implementation plan](docs/implementation-plan.md)
- [Roadmap](docs/roadmap.md)
- [Development guide](docs/development.md)
- [Deployment guide](docs/deployment.md)
- [Brave Origin migration](docs/brave-origin-migration.md)
- [Stage 2 browser transport report](docs/stage-2-browser-transport.md)
- [Stage 3 profiles and sessions report](docs/stage-3-profiles-sessions.md)
- [Stage 4 controller shell report](docs/stage-4-controller-shell.md)
- [Stage 5 YouTube application report](docs/stage-5-youtube-application.md)
- [Stage 6 operations report](docs/stage-6-operations.md)
- [Stage 7 concurrent sessions report](docs/stage-7-concurrent-sessions.md)
- [Archived Stage 8 Firefox add-on report](docs/stage-8-firefox-addons.md)
- [Final functional hardening report](docs/final-hardening-pass.md)
- [Claude Opus 5 visual-polish handoff](docs/claude-opus-5-polish-handoff.md)
