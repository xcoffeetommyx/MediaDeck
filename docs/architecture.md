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
  - WebSocket transport by default
  - Isolated profile
```

The initial release may run only one browser worker. Browser workers are
addressed by session ID so later releases can run separate workers for multiple
profiles concurrently. The backend uses a transport-neutral browser-worker
contract; Selkies-specific URLs and container details do not enter profile or
application APIs.

Stage 3 creates workers through a replaceable driver. The production driver
uses the local Docker Engine API. Each worker mounts only one existing
subdirectory of `mediadeck-data` at `/config`:

```text
Persistent: profiles/<profile-uuid>/firefox
Guest:      runtime/guests/<session-uuid>/firefox
```

SQLite stores profile metadata, session history, worker identity, health state,
timestamps, and locks. Worker IDs and storage paths remain internal and are
never included in public session responses.

See [Architecture Decisions](architecture-decisions.md) for the accepted
constraints and [Implementation Plan](implementation-plan.md) for delivery
stages.
