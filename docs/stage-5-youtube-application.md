# Stage 5 YouTube Application

Date: 2026-07-28

Status: Complete with a target-client fullscreen follow-up

## Outcome

YouTube is now the first complete MediaDeck application. Selecting its home
tile starts or resumes an isolated Firefox session for the selected profile,
connects the session through MediaDeck, keeps it alive while open, and releases
it through a consistent return flow.

The implementation includes:

- a small internal application registry with a stable `youtube` ID
- application-aware browser session history and a schema version 3 migration
- idempotent client-generated session IDs for refresh and request retry safety
- opaque session stream URLs
- HTTP and WebSocket proxying over the private Compose network
- Firefox kiosk mode
- loading, ready, live, reconnecting, offline, recovery, and stop-failure states
- video and audio pipeline status from the Selkies client
- reload, fullscreen, and MediaDeck return controls
- session heartbeat and worker crash recovery
- session-tab resume state
- persistent profile storage and temporary Guest cleanup

## Stream Routing

Each dynamic worker receives:

```text
SUBFOLDER=/stream/<session-uuid>/
```

The worker remains attached only to the private Compose network and publishes
no host ports. MediaDeck validates the opaque session ID, confirms that the
session is active, obtains the internal target from the worker driver, and
proxies both normal HTTP traffic and WebSocket upgrades without exposing the
target to the client.

This is concurrent-session-safe routing even though the default host capacity
remains one. Stage 7 will add multi-user authorization and representative load
testing without changing the public path shape.

## Application and Profile Behavior

The session table now records `application_id`. Existing databases migrate
forward with historical sessions assigned to YouTube, which was the only
supported application before this stage.

Application launch accepts a client-generated UUID. Retrying the same launch
returns or recovers the same session instead of creating another worker. A
persistent profile can also resume its existing active YouTube session after a
page refresh. The Firefox launch URL comes from the trusted application
registry rather than client input.

Firefox starts with `--kiosk`, so tabs, the address bar, menus, and generic
browser chrome remain outside the MediaDeck experience. Each persistent profile
continues to mount only its own Firefox directory, preserving cookies and
YouTube login state. Guest uses a session-specific runtime directory that is
removed after return.

## Viewer Behavior

The MediaDeck control bar occupies reserved space above the stream rather than
covering YouTube controls. It provides:

- a MediaDeck return action
- current profile
- live video and audio state
- stream reload
- browser fullscreen request

The Selkies client runs in the same origin through the proxy. MediaDeck reads
its pipeline status events, uses a deliberate Enter YouTube action to satisfy
audio activation rules, and keeps a heartbeat active while the viewer is open.
Reloading the iframe reconnects to the same running Firefox process.

Returning waits for the worker to stop. If stop fails, MediaDeck keeps the user
in the viewer with a retry action rather than silently leaking a Guest session
or consuming capacity.

## Validation

The complete quality gate passes:

- formatting
- linting
- TypeScript type checking
- 52 automated tests
- production frontend and backend builds

Automated coverage includes:

- application contract and discovery
- schema migration and application-aware sessions
- idempotent launch
- opaque stream targets
- real HTTP proxying
- real WebSocket upgrade proxying
- profile launch and release UI
- launch failure and retry UI
- controller-shell regression coverage
- automated accessibility checks

A disposable production Compose stack also proved:

- the application became healthy using the Docker worker driver
- the visible UI created and retained a persistent profile
- the profile survived application container rebuilds
- a worker launched with no host-published ports
- Firefox opened YouTube in kiosk mode
- MediaDeck reported live video and audio
- reload reconnected to the same Firefox session
- return stopped and removed the profile worker
- Guest storage existed only while the Guest session was active
- Guest return stopped the worker and deleted its runtime directory
- browser diagnostics contained no MediaDeck errors

Selkies still logs the previously documented non-fatal wake-lock denial in the
embedded automation client. The client does not grant document fullscreen, so
the fullscreen control's success path remains a manual target-browser check.
The viewer now reports a clear fallback when a client blocks the request.

## Deferred Work

Stage 6 owns administrator settings, updates, diagnostics, and operations.
Stage 7 owns multi-user authorization, higher concurrency limits, load
measurement, and failure isolation. Stage 8 owns Firefox add-on management.
Final visual polish remains reserved for the Claude Opus 5 handoff after the
functional stages are complete.

## References

- [Firefox command-line parameters](https://firefox-source-docs.mozilla.org/browser/CommandLineParameters.html)
- [LinuxServer Selkies base image](https://github.com/linuxserver/docker-baseimage-selkies)
