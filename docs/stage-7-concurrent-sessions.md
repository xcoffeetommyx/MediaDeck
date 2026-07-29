# Stage 7: Concurrent Sessions

Status: Complete (2026-07-28)

## Delivered

Stage 7 turns the session-ready Stage 3 design into a bounded concurrent
runtime:

- configurable capacity from 1 to 16 simultaneous Firefox workers
- simultaneous workers for different persistent profiles
- the existing one-active-worker-per-profile database lock
- independent temporary Guest workers
- a client-generated, 256-bit credential for every browser session
- SHA-256-only session credential storage and timing-safe verification
- session authorization for lifecycle APIs, stream HTTP, and stream WebSockets
- path-scoped HttpOnly stream cookies with no token in stream URLs
- public capacity and idle-policy feedback
- CPU, memory, PID, and shared-memory ceilings per worker
- optional Linux Intel/AMD DRI device assignment
- live CPU, memory, process, network, GPU-mode, and encoded-bandwidth reporting
- controller-visible capacity and per-stream resource status
- per-session health monitoring, idle shutdown, crash recovery, and failure
  isolation

The default remains one active session. Operators opt into concurrency only
after sizing the Linux host. The database schema is now version 5.

## Session Authorization

The controller creates a random access token before launch and keeps it only in
that browser tab's `sessionStorage`. The API stores a SHA-256 digest, never the
raw token. Launch is retry-safe because the same session ID and token can be
submitted again.

Lifecycle requests send the credential in
`X-MediaDeck-Session-Token`. Successful launch also installs a Secure,
SameSite-strict, path-scoped HttpOnly cookie beneath
`/stream/<session-id>/`; this lets all Selkies assets and WebSocket upgrades
authenticate without placing secrets in query strings.
MediaDeck removes its cookie before proxying to the worker.

A token for one session cannot read, refresh, recover, stop, or stream another
session. A pre-Stage-7 active session without a credential digest is stopped
during startup reconciliation rather than exposed without authorization.

## Capacity and Resource Model

`MAX_BROWSER_SESSIONS` is the global admission ceiling. SQLite checks capacity
and the profile lock in the same transaction. Excess launches receive HTTP 429
with `capacity_reached`; the home screen also disables new launches while the
host is full.

Every Docker worker receives:

- `NanoCpus` from `BROWSER_WORKER_CPUS`
- hard memory and equal memory-plus-swap ceilings from
  `BROWSER_WORKER_MEMORY_MB`
- `PidsLimit` from `BROWSER_WORKER_PIDS_LIMIT`
- `/dev/shm` sizing from `BROWSER_WORKER_SHM_MB`
- the configured encoded-video ceiling from `BROWSER_VIDEO_BITRATE`

The protected resource report samples Docker's non-streaming stats endpoint.
It exposes per-session CPU percentage, current and limited memory, network
receive/transmit counters, process count, GPU mode/device, and video bitrate
without exposing a Docker worker ID or internal address.

Software x264 remains the portable default. `BROWSER_WORKER_GPU_MODE=dri`
assigns the configured Intel/AMD render node and allows Selkies to use its
Wayland/VA-API path. GPU utilization percentages are host/vendor-specific and
are not claimed; the report makes device assignment and mode observable.

## APIs

- `GET /api/v1/capacity` — public slot count and idle policy
- `GET /api/v1/operations/resources` — administrator-protected limits and
  per-session samples
- session lifecycle routes — require `X-MediaDeck-Session-Token`
- `/stream/<session-id>/...` — requires the session's path-scoped cookie for
  HTTP and WebSocket traffic

## Validation

Automated validation covers:

- two different profiles running concurrently
- one profile never being mounted twice
- capacity rejection independent of profile locking
- wrong-token and missing-token denial
- authenticated HTTP and WebSocket proxying
- capacity-aware controller behavior
- resource report contracts and controller display
- one crashed worker recovering while a second worker and profile stay
  untouched
- database migration to credential-digest storage

The complete formatting, lint, type, 64-test, build, and Compose-configuration
checks pass.

Live validation used the production image on Docker Engine 29.4.3 with a
disposable Compose project and two persistent profiles:

- both isolated Firefox containers reached `running`
- capacity reported `2/2`, and a third session received HTTP 429
- a credential from session one received HTTP 401 against session two
- two independent resource samples were returned
- Docker inspection confirmed the configured 1 CPU, 1536 MiB memory, and
  384-process ceilings
- forced removal of worker one produced a replacement worker
- worker two remained `running`
- explicit stop returned active capacity to zero

The disposable containers, network, image tag, and volume were removed after
validation.

## Operational References

- [Deployment and concurrency runbook](deployment.md)
- [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)
- [Docker Engine API](https://docs.docker.com/reference/api/engine/)
- [LinuxServer Selkies GPU configuration](https://github.com/linuxserver/docker-baseimage-selkies#gpu-configuration)

## Deferred Work

Stage 8 owns managed Firefox add-ons. Functional implementation remains with
Codex. Final visual polish remains reserved for the Claude Opus 5 handoff after
the functional stages.
