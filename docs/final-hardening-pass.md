# Final Functional Hardening Pass

Status: Complete (2026-07-28)

## Purpose

This pass audited MediaDeck's non-visual release paths after Stage 8 and before
the Claude Opus 5 presentation-only pass. It focused on failures that could
prevent startup, corrupt recovery state, leave workers running, produce an
inconsistent backup, or make a profile inaccessible.

## Findings Fixed

### Crash-safe restore commit

Restore now distinguishes a pending swap from a committed restore. If the app
or host stops after moving the prior database or profile directory, the next
startup first rolls the interrupted swap back and then retries from the
validated backup. A committed marker prevents cleanup failures from
incorrectly rolling a successful restore back after the prior database has
already been deleted.

Temporary, previous, and completed artifacts are recovered or cleaned
deterministically. Fault-injection tests cover both an interrupted swap and a
failure while copying restored profile files.

### Backup and state-mutation consistency

A shared FIFO coordinator serializes profile filesystem changes, add-on
mutations, session admission, and backup creation. A session cannot become
active between the backup's active-session check and profile copy, and profile
or add-on changes cannot race the filesystem/database snapshot.

The queue continues after a failed operation, and simultaneous add-on updates
cannot allow an older version to overwrite a newer version.

### Worker lifecycle cleanup

If Docker creates a Firefox worker but SQLite cannot persist its worker ID,
MediaDeck now removes that worker before marking the session failed. Startup
initialization failures stop timers and active workers, close owned storage,
and close the partially built server. Signal shutdown is guarded against
duplicate signals and records failure instead of producing an unhandled
rejection.

Docker Engine requests now time out after 30 seconds, preventing a wedged
socket or daemon from hanging an API operation indefinitely.

Optional operation-log writes are now isolated from the operation they
describe. A logging failure cannot turn a successfully created profile,
running worker, completed backup, changed setting, or approved update into an
API failure or orphaned state. A fault-injection test verifies that a worker
remains valid when its session event cannot be recorded.

### Add-on atomicity and volume ownership

Add-on install, update, enable/disable, and remove operations are serialized.
Database changes roll back if atomic policy generation fails. Package cleanup
errors no longer report a logically successful update as failed, and
byte-identical retries regenerate policy state.

Firefox policy files use mode `0644` because the policy mount is read-only and
Firefox must be able to read it after LinuxServer switches users. `PUID` is
required to remain 1000 so the application and Firefox worker cannot take
shared profile ownership away from one another.

Atomic JSON writers remove temporary files after failed renames.

## Validation

The complete release gate passes:

- formatting, lint, TypeScript, tests, and production builds
- 81 automated tests across configuration, contracts, API, storage, sessions,
  add-ons, Docker timeout behavior, restore fault injection, UI interaction,
  controller navigation, and accessibility
- production and development Compose configuration, including browser-spike
  and optional GPU overlays
- production dependency audit with no known vulnerabilities

Live validation used the pinned production image, Docker Engine 29.4.3,
Firefox 153, and Mozilla-signed uBlock Origin 1.72.2:

- app, database, and worker diagnostics were healthy
- the signed extension was active and its policy mode was `0644`
- the Firefox policy volume remained read-only
- backup creation and restart-applied restore succeeded
- restored profile add-on inventory remained intact
- no restore request or completed marker remained
- graceful application shutdown removed the dynamic Firefox worker
- restart retained the profile and backup

Disposable containers, worker, image tag, network, volume, and downloaded XPI
were removed.

## Remaining Environment Checks

No known code-level release blocker remains. These checks inherently require
the final Linux host or target client and remain operator validation rather
than missing implementation:

- optional Intel/AMD DRI hardware encoding on the chosen host
- host capacity under the intended number of simultaneous 1080p streams
- protected-media/Widevine playback if the selected YouTube content requires it
- target-device document fullscreen behavior
- the intended physical gamepad, touch device, display, and audio route

The Claude Opus 5 pass must remain visual and interaction polish only; it must
not alter these hardened lifecycle, storage, policy, security, or recovery
boundaries.
