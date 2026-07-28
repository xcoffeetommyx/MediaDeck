# MediaDeck – Project Handoff

This repository is a project specification for GPT Sol / Claude Code.

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

## Project Documents

- [Product specification](docs/product-spec.md)
- [Architecture](docs/architecture.md)
- [Architecture decisions](docs/architecture-decisions.md)
- [Implementation plan](docs/implementation-plan.md)
- [Roadmap](docs/roadmap.md)
