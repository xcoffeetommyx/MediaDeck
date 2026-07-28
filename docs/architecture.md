# Architecture

```text
MediaDeck
├── Frontend
├── Backend
├── Profile Manager
├── App Launcher
├── Settings
├── Update Manager
├── Controller Manager
└── Firefox Engine
    └── YouTube
```

The architecture must support additional applications later without redesign.
Treat YouTube as the first application implementation.

## Runtime Topology

The production deployment runs on a headless Linux Docker host.

```text
Tailscale Serve
       |
MediaDeck Web/API
       |
Session Manager
       |
Browser Worker(s)
  - Firefox
  - Selkies
  - Isolated profile
```

The initial release may run only one browser worker. Browser workers are
addressed by session ID so later releases can run separate workers for multiple
profiles concurrently.

See [Architecture Decisions](architecture-decisions.md) for the accepted
constraints and [Implementation Plan](implementation-plan.md) for delivery
stages.
