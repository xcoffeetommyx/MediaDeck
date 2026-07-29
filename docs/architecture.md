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

Stage 6 adds an operations layer beside the session manager:

```text
Administrator Access
  -> expiring in-memory unlock tokens
  -> privileged route guard
Settings / Operations
  -> SQLite settings and bounded event log
  -> health and reconciliation
Backup Manager
  -> SQLite snapshot + persistent profile copy
  -> restart-applied restore request
Update Manager
  -> HTTPS digest-pinned manifest
  -> backup-first approval
  -> host-side container replacement
```

These services depend on the existing store and worker contracts but do not
enter the video-stream proxy. That keeps operations traffic off the
latency-sensitive streaming path and leaves worker capacity replaceable for
Stage 7.

Stage 7 activates the concurrent form of this topology. SQLite atomically
enforces both the global worker ceiling and one active mount per profile.
Every session has an independent credential digest. Lifecycle APIs authorize
with a session header; the HTTP/WebSocket gateway authorizes with an HttpOnly
cookie scoped to the opaque stream path. Each worker receives Docker CPU,
memory, PID, and shared-memory limits, while resource samples stay behind the
administrator boundary. Failure recovery operates per session and never
replaces a healthy sibling worker.

See [Architecture Decisions](architecture-decisions.md) for the accepted
constraints and [Implementation Plan](implementation-plan.md) for delivery
stages.
