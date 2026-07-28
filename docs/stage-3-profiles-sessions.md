# Stage 3 Profiles and Sessions

Date: 2026-07-28

Status: Complete

## Outcome

MediaDeck now owns persistent profiles and browser-session lifecycle. The
implementation supports one active session by default without embedding a
global-singleton assumption in the database, APIs, or worker driver.

Stage 3 includes:

- persistent profile create, read, update, and delete
- SQLite metadata and forward migration support
- isolated Firefox directories keyed by immutable UUID
- temporary Guest directories keyed by session UUID
- active-profile locking enforced by SQLite
- configurable host capacity
- dynamic Docker worker creation and removal
- heartbeat, idle shutdown, health reconciliation, and crash recovery
- graceful application shutdown and interrupted-stop reconciliation
- public session responses that hide Docker and filesystem details

## Data Model

SQLite is stored at `/data/database/mediadeck.sqlite` in WAL mode.

`profiles` contains the immutable profile ID, editable display data, timestamps,
and a soft-delete timestamp. Soft deletion preserves foreign-key integrity for
session history while the associated Firefox directory is removed.

`browser_sessions` contains:

- session UUID
- `profile` or `guest` kind
- nullable profile UUID
- lifecycle status
- internal Firefox storage subpath
- internal Docker worker ID
- health/failure state and timestamps

A partial unique index permits only one `starting`, `running`, or `stopping`
session for a persistent profile. There is no database-wide singleton row.

## Storage Isolation

Persistent workers mount:

```text
profiles/<profile-uuid>/firefox
```

Guest workers mount:

```text
runtime/guests/<session-uuid>/firefox
```

Docker's volume-subpath mount exposes only that directory at the worker's
`/config`. The directory is created before Docker receives the request. Guest
storage is recursively removed after stop, failed creation, idle expiry, or
graceful application shutdown.

## Lifecycle

New sessions begin as `starting`. Health monitoring promotes a healthy worker
to `running`. Clients update `lastSeenAt` through the heartbeat endpoint. An
idle session is stopped after the configured timeout.

When a worker disappears or reports unhealthy:

1. MediaDeck removes the old worker identity.
2. The existing session row returns to `starting`.
3. A replacement worker mounts the same profile directory.
4. The opaque session ID remains unchanged.

Stopped sessions are terminal. Failed active sessions may be recovered
explicitly if capacity and profile locks permit it.

Graceful MediaDeck shutdown stops and removes active workers before the Compose
network is removed. Startup reconciliation handles workers or session rows left
by an abrupt failure.

## Docker Boundary

`compose.sessions.yaml` gives the unprivileged MediaDeck process supplementary
access to `/var/run/docker.sock`. The application calls the Docker Engine HTTP
API directly and does not require the Docker CLI in its runtime image.

This is lightweight, but Docker socket access is privileged host access. The
deployment must remain on the trusted Tailscale path. Separating the driver into
a smaller authenticated worker-manager service is a future defense-in-depth
option, not a prerequisite for Stage 4.

Dynamic workers:

- use the Stage 2 digest-pinned Firefox image
- join only the MediaDeck Compose network
- publish no host ports
- mount one data-volume subpath
- have no restart policy
- disable nested Docker and unnecessary Selkies features
- are labeled with their opaque session ID and kind

## Validation

Automated coverage proves:

- metadata survives database close and reopen
- an early schema upgrades without losing profiles
- malformed API input returns a structured error
- profile CRUD creates and removes the correct directories
- one profile cannot acquire two active locks
- different profiles can use a raised capacity limit
- the configured capacity limit is independent of profile locking
- Guest storage disappears after stop
- idle sessions stop
- worker health promotes `starting` to `running`
- interrupted stops complete during reconciliation
- public responses omit worker IDs and storage paths

Live Docker integration proved:

- the API can create a worker through the Unix socket
- Docker mounts the requested `mediadeck-data` subdirectory at `/config`
- removing a worker externally and sending a heartbeat creates a replacement
- a marker in the persistent Firefox directory survives that replacement
- a duplicate active profile request returns HTTP 409
- Guest and deleted-profile directories are removed
- graceful Compose shutdown removes the dynamic worker and Guest directory

## Deferred Work

Stage 3 does not yet proxy the Selkies stream through a public session route.
That launch/return experience belongs to Stage 5 after the Stage 4 shell and
navigation model exist. Multi-user authorization, load testing, and per-session
routing remain Stage 7.

## References

- [Docker volume subpath mounts](https://docs.docker.com/engine/storage/volumes/#mount-a-volume-subdirectory)
- [Docker daemon socket security](https://docs.docker.com/engine/security/protect-access/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
