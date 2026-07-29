# Implementation Plan

MediaDeck will be implemented in independently verifiable stages. A stage is
complete only when its documented validation checks pass.

## Stage 1: Repository Foundation

Status: Complete (2026-07-28)

Scope:

- TypeScript workspace structure
- React/Vite frontend
- Fastify backend
- Shared configuration and contracts package
- Docker Compose development and production foundations
- Persistent storage layout
- Linting, formatting, tests, builds, and CI
- Placeholder MediaDeck landing page

Not included:

- Firefox
- Remote streaming
- YouTube integration
- Controller support
- Add-on management

Validation:

- A clean checkout installs and builds
- Development services start together
- Production containers build without warnings
- Health checks pass
- Persistent paths are documented and ignored correctly

## Stage 2: Browser Transport Spike

Status: Complete with documented hardware validation follow-ups (2026-07-28)

Scope:

- Headless Firefox worker
- Selkies WebSocket display and audio transport
- Software encoding baseline
- Optional hardware-acceleration configuration
- Mouse and keyboard input
- Session reconnection
- YouTube codec and protected-media investigation

Validation:

- A remote client can watch and hear YouTube
- Input remains responsive
- Disconnecting the client does not immediately destroy the session
- The worker runs on a headless Linux Docker host
- Measured CPU, memory, bandwidth, startup time, and interaction latency are
  recorded

This stage is a technical gate. If Selkies is unsuitable, evaluate KasmVNC
behind the same session interface before proceeding.

Selkies passed the gate. Touch hardware, Widevine protected playback, and the
optional Linux GPU override remain manual release-hardware checks; see
[Stage 2 Browser Transport](stage-2-browser-transport.md).

## Stage 3: Profiles and Session Lifecycle

Status: Complete (2026-07-28)

Scope:

- Persistent profile CRUD
- Ephemeral Guest sessions
- Per-profile Firefox storage
- Browser-worker lifecycle
- Session ownership, locks, health, timeout, and crash recovery
- APIs and database schema that support future concurrent sessions

Validation:

- Profile data remains isolated
- Guest data is removed after exit
- A profile cannot be mounted by two workers
- A crashed worker can be recovered without corrupting the profile
- The design can create workers keyed by session/profile rather than relying
  on a global singleton

Validation completed with SQLite reopen tests, lifecycle API tests, and live
Docker integration. A worker was removed outside MediaDeck and recovered under
the same session ID with its Firefox marker intact. Guest data was removed
after explicit stop and graceful Compose shutdown. See
[Stage 3 Profiles and Sessions](stage-3-profiles-sessions.md).

## Stage 4: Controller-First Application Shell

Status: Complete (2026-07-28)

Scope:

- Profile selection
- Home screen
- Focus and navigation system
- Gamepad API integration
- Keyboard, mouse, and touch parity
- Settings and Updates placeholders
- Responsive TV, tablet, and desktop layouts

Validation:

- Every primary workflow works with a controller
- Focus is always visible and predictable
- Back navigation is consistent
- Touch targets and text remain usable at supported sizes
- Accessibility checks pass

Validation completed with component interaction tests, Gamepad mapping tests,
automated axe-core checks, a production Docker build, and live responsive
browser checks at TV, tablet, and phone sizes. Profile creation was exercised
against the real SQLite API. Focus, Back behavior, and controller-style
scrolling were verified in the production shell. See
[Stage 4 Controller Shell](stage-4-controller-shell.md).

## Stage 5: YouTube Application

Status: Complete with documented target-client fullscreen follow-up (2026-07-28)

Scope:

- YouTube application definition
- Launch and return flow
- Persistent login state per profile
- Browser-session controls
- Loading, error, offline, and recovery experiences

Validation:

- Different profiles retain different YouTube accounts
- MediaDeck chrome hides implementation details where practical
- Playback, fullscreen behavior, audio, and reconnect behavior are reliable

Validation completed with application and session contract tests, real HTTP and
WebSocket gateway tests, a production Docker build, and a live profile and
Guest walkthrough through the MediaDeck route. The live client reported video
and audio active, stream reload reconnected to the same worker, Firefox kiosk
mode hid browser chrome, persistent profile data survived application rebuilds,
and Guest storage was removed on return. Browser fullscreen is implemented with
an explicit failure experience; final fullscreen behavior remains a target
client check because the embedded automation browser does not grant document
fullscreen. See [Stage 5 YouTube Application](stage-5-youtube-application.md).

## Stage 6: Settings, Updates, and Operations

Status: Complete (2026-07-28)

Scope:

- Administrator settings
- Optional administrator PIN
- Update checks and approved update workflow
- Backup and restore foundations
- Logs, diagnostics, health reporting, and recovery controls
- Tailscale deployment documentation

Validation:

- Privileged actions are protected when a PIN is configured
- Failed updates have a documented recovery path
- Operators can diagnose unhealthy services without opening containers
- The default service is private to the tailnet

Validation completed with PIN authorization and rate-limit tests, a real
SQLite/profile backup restored across an application restart, digest-pinned
manifest and failed-check tests, controller-accessible operational screens, the
complete quality gate, a production container build, and live API/UI checks.
Compose publishes only to `127.0.0.1`; Tailscale Serve is the documented HTTPS
entry point and Funnel remains disabled. See
[Stage 6 Settings, Updates, and Operations](stage-6-operations.md).

## Stage 7: Concurrent Sessions

Status: Complete (2026-07-28)

Scope:

- Configurable worker pool and resource limits
- Simultaneous sessions for different profiles
- Per-session routing and authorization
- Idle policy and capacity feedback
- Multi-session load and failure isolation

Validation:

- Two or more different profiles can stream independently
- Failure or shutdown of one worker does not interrupt another
- The host rejects excess sessions cleanly
- CPU, memory, GPU, and bandwidth limits are observable

The session, storage, and driver boundaries from earlier stages supported this
work without structural redesign.

Validation completed with session-authorization, capacity, worker-resource,
HTTP/WebSocket gateway, controller, and failure-isolation tests plus a live
two-profile production-container exercise. The live host rejected a third
session, enforced Docker CPU/memory/PID ceilings, recovered one forcibly removed
worker, and kept the second worker running. See
[Stage 7 Concurrent Sessions](stage-7-concurrent-sessions.md).

## Stage 8: Firefox Add-on Management

Status: Complete (2026-07-28)

Scope:

- Per-profile add-on inventory
- Install `.xpi`
- Enable, disable, remove, and update
- Optional watched add-ons directory
- Policy and compatibility safeguards

Validation:

- Add-on changes affect only the selected profile
- Invalid or incompatible packages fail safely
- Managed MediaDeck policies remain intact

This stage targets v1.1.

Validation completed with package/parser, profile-isolation, policy-state,
watched-directory, API, and controller UI tests plus a live production-container
exercise on Firefox 153. Mozilla-signed uBlock Origin was active only in its
selected profile, its policy mount was read-only, an active profile rejected
changes, disabling removed the extension on relaunch, and a watched package was
imported only into a second profile. See
[Stage 8 Firefox Add-on Management](stage-8-firefox-addons.md).

## Final Functional Hardening Pass

Status: Complete (2026-07-28)

Before visual polish, startup, shutdown, restore, backup consistency, Docker
failure, add-on concurrency, shared-volume ownership, dependency, Compose, and
production-container paths received a release-style fault-injection pass. No
known functional release blocker remains. See
[Final Functional Hardening Pass](final-hardening-pass.md).

## Stage 9: Product Polish and Release

Scope:

- Performance and reliability pass
- Accessibility audit
- Visual consistency and motion review
- Empty, loading, error, update, and recovery states
- Claude Opus 5 polish handoff
- Integration review and regression testing
- Release and operator documentation

Validation:

- The complete product works with controller, touch, mouse, and keyboard
- Functional behavior is unchanged by the polish pass
- Automated checks and representative end-to-end scenarios pass
- Installation and recovery can be performed from the documentation
