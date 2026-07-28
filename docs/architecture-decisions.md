# Architecture Decisions

This document records the decisions that guide MediaDeck implementation. It
supplements the product specification and prevents later implementation work
from accidentally changing the product direction.

## 1. Production Platform

Status: Accepted

MediaDeck is developed from Windows but deployed as a headless Linux
application using Docker Compose.

The production baseline is:

- Linux on `amd64`
- Docker Engine with the Compose plugin
- No host desktop environment
- Software video encoding as the compatibility baseline
- Optional hardware acceleration for supported Intel, AMD, and NVIDIA systems

The base deployment must remain usable without a GPU. Hardware-specific
configuration belongs in optional Compose overrides and must not complicate the
default installation.

## 2. Remote Firefox Transport

Status: Accepted after Stage 2 spike (2026-07-28)

Selkies is the remote-display provider. MediaDeck uses Selkies' single-port
WebSocket transport as its default because it works through an ordinary HTTPS
reverse proxy without host networking, a TURN service, or a large UDP port
range. WebRTC remains an optional future transport mode for installations where
its additional networking requirements are justified.

The Stage 2 browser implementation proved:

- YouTube video playback in Firefox
- Audio delivery to the client
- Mouse and keyboard input
- Interactive software encoding on the development host
- Reconnection without losing the Firefox session
- YouTube AV1 video and Opus audio playback

Touch input, Widevine playback, and Linux hardware acceleration still require
validation on their representative hardware. They do not block the default
software-encoded worker, but they remain explicit deployment gates before a
general release.

KasmVNC is the fallback transport if the Selkies spike uncovers an unacceptable
compatibility, maintenance, or deployment limitation. The rest of MediaDeck
must communicate through a transport-neutral session interface so this choice
does not leak throughout the application. Stage 2 adds that boundary through
the browser-worker health contract.

## 3. Session Model

Status: Accepted

The initial release may operate one active Firefox session at a time. The
architecture and data model must support concurrent sessions later.

The long-term model is:

- One isolated browser worker per active MediaDeck profile
- Different profiles may stream concurrently
- A single Firefox profile directory may be mounted by only one worker at a
  time
- The session manager owns worker creation, health checks, reconnection, idle
  shutdown, and cleanup
- Each client connects through an opaque session ID rather than directly to a
  container name or port
- Resource limits and a configurable concurrency ceiling protect the host

Concurrent use is deliberately postponed until the single-session lifecycle is
reliable. No database schema or API may assume that only one global session can
ever exist.

Stage 3 implements this model with a configurable capacity limit that defaults
to one. SQLite enforces a partial unique index across active sessions for each
persistent profile. The worker driver and database support different profiles
concurrently when the capacity setting is raised; multi-user routing and load
validation remain Stage 7.

Stage 5 assigns every worker a Selkies subfolder derived from its opaque session
UUID. MediaDeck proxies that HTTP and WebSocket path to the worker over the
private Compose network. Workers continue to publish no host ports, and browser
clients never receive a container name or internal address. This routing model
supports concurrent workers without changing public stream URLs; Stage 7 adds
multi-user authorization and load validation.

## 4. Profile Isolation

Status: Accepted

Every persistent profile has:

- An immutable UUID
- An editable display name and avatar
- A dedicated Firefox profile directory
- MediaDeck-specific preferences
- Independent cookies, login state, bookmarks, preferences, and future add-ons

Profile display names are never used as filesystem keys.

Guest is temporary. Guest receives a unique runtime directory for each session,
and that directory is deleted after the session ends. Guest browser history,
cookies, logins, preferences, and add-ons do not persist.

Profile deletion is implemented as a metadata soft delete so historical session
records keep referential integrity. The associated Firefox directory is removed
only after MediaDeck confirms that no active session holds the profile lock.

## 5. Application Extensibility

Status: Accepted

YouTube is the only application implemented in v1. MediaDeck will use a small
internal application contract rather than a general-purpose plugin system.

An application definition may provide:

- Stable ID
- Display name and artwork
- Launch URL
- Availability
- Firefox launch or policy settings
- Future application-specific capabilities

This boundary must make additional media applications possible without adding
dynamic third-party plugin loading to v1.

## 6. Firefox Add-ons

Status: Accepted for future implementation

Add-on management is deferred to v1.1. The v1 profile and browser-worker design
must preserve per-profile add-on state and must not bake extensions into a
shared mutable Firefox profile.

Future add-on management will support installation, enable/disable, removal,
updates, and an optional watched add-ons directory. Firefox enterprise policy
configuration and user-installed extension state must remain separate so that
managed MediaDeck behavior cannot be accidentally overwritten by a user
extension.

## 7. Networking and Authentication

Status: Accepted

The default production deployment is private to a Tailscale tailnet:

- Tailscale Serve terminates HTTPS
- Tailscale Funnel is not enabled
- The MediaDeck HTTP service is not exposed directly to the LAN
- The backend may consume Tailscale identity headers only from the trusted
  local proxy path
- YouTube credentials remain inside the relevant Firefox profile

An optional MediaDeck administrator PIN will protect destructive or privileged
actions such as profile deletion, updates, and sensitive settings. Parental
controls and profile PINs remain roadmap items.

## 8. Storage Layout

Status: Accepted

SQLite stores MediaDeck metadata. Firefox profile contents remain filesystem
data.

The persistent volume follows this conceptual layout:

```text
/data/
  database/
  profiles/
    <profile-uuid>/
      firefox/
  backups/
  runtime/
```

Temporary Guest data, sockets, locks, and active-session state belong under
`runtime`. Runtime data is excluded from backups and may be safely reconstructed
after a restart.

## 9. Updates

Status: Accepted

The initial update experience automatically checks for updates but requires
administrator approval before installation.

Updates use pinned versions and include:

- Active-session shutdown or deferral
- Metadata/configuration backup
- Forward database migrations
- Post-update health checks
- A documented rollback procedure

Unattended updates may be added later as an explicit administrator choice.

## 10. Final Product Polish

Status: Accepted

Core implementation, testing, and functional UX are completed first. Near the
end of the project, a self-contained design-system and UX handoff will be
prepared for a final Claude Opus 5 polish pass. Any resulting changes must still
pass MediaDeck's accessibility, controller-navigation, responsive-layout, and
automated quality checks before integration.

## 11. Controller Navigation

Status: Accepted after Stage 4 (2026-07-28)

MediaDeck uses native semantic controls plus a small spatial-navigation layer.
The focused element remains ordinary browser focus, so controller navigation
does not create a second hidden selection state.

The standard controller mapping is:

- D-pad or left stick: move focus spatially
- A: activate the focused control
- B: close the current overlay or move back one application view

Arrow keys, Enter, Escape, and Backspace follow the same navigation model.
Mouse and touch activate the same buttons and routes. Directional repeat uses a
dead zone and delay so an analog stick cannot skip unpredictably through the
interface.

Focus selection is based on rendered element geometry with a deterministic DOM
order fallback for test and unusual layout environments. Dialogs form their
own focus-navigation boundary. Every view chooses an initial focus target,
keeps the focus ring visible, and returns to the top of the new view rather
than preserving an unrelated scroll position.
