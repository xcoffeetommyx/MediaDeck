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

Scope:

- Headless Firefox worker
- Selkies WebRTC display and audio transport
- Software encoding baseline
- Optional hardware-acceleration experiments
- Mouse, touch, and keyboard input
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

## Stage 3: Profiles and Session Lifecycle

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

## Stage 4: Controller-First Application Shell

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

## Stage 5: YouTube Application

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

## Stage 6: Settings, Updates, and Operations

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

## Stage 7: Concurrent Sessions

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

This stage may ship after the first usable MediaDeck release, but earlier stages
must not require structural redesign to support it.

## Stage 8: Firefox Add-on Management

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
