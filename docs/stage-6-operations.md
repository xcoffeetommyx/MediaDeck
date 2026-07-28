# Stage 6: Settings, Updates, and Operations

Status: Complete (2026-07-28)

## Delivered

Stage 6 replaces the Settings and Updates placeholders with the operational
layer needed for a headless appliance:

- optional 4–12 digit administrator PIN
- salted scrypt PIN hashing and timing-safe verification
- memory-only, 15-minute administrator unlock tokens
- five-attempt, 15-minute PIN retry limiting per client
- one authorization guard for settings, profile deletion, backups, restore,
  recovery, and updates
- persisted maintenance settings and bounded event history
- service, worker, SQLite, storage, profile, and session diagnostics
- manual browser-session reconciliation
- atomic SQLite and persistent Firefox-profile backups
- configurable backup retention
- validated, restart-applied restore requests
- HTTPS release-manifest checks
- mandatory digest-pinned release images
- backup-first update approval
- a host-side update script with health verification and automatic rollback
- a private Tailscale Serve deployment and recovery runbook

Guest remains temporary. Backup scope contains SQLite metadata and persistent
profiles, not Guest or reconstructible runtime data. The database schema is now
version 4.

## Security Boundary

MediaDeck still publishes only `127.0.0.1:8080`; dynamic Firefox workers publish
no host ports. Tailscale Serve is the production HTTPS entry point and Funnel
is explicitly excluded.

The optional PIN is defense in depth for people already allowed onto the
tailnet. Enabling it does not interrupt profile selection or active streaming.
It does protect destructive and privileged operations. Unlock tokens are not
written to SQLite or local storage and disappear on server restart; the web
client keeps its token only in `sessionStorage`.

The application already needs Docker socket access to launch Firefox workers.
Stage 6 deliberately does not turn that into browser-triggered self-replacement.
The app validates and approves a release; the host script performs the
container replacement and health check.

## Backup and Restore Model

A backup can start only with zero active sessions. SQLite's backup API produces
a consistent database file while profile data is copied into a temporary
directory. The manifest is written last and the directory is atomically
renamed, so interrupted work is never presented as a restorable backup.

A restore is scheduled rather than performed against an open database. On the
next app restart, MediaDeck validates the request and manifest, stages the
database, swaps database and profile paths, rolls the swap back on failure, and
removes the request only after success.

## Update Model

The configured update URL must be HTTPS. The response must use schema version 1
and identify an image by `sha256` digest. Redirects are rejected. Release checks
have a ten-second timeout and record errors without making the application
unhealthy.

Approval requires no active stream. It creates a backup, persists the exact
release and backup IDs, and writes a host-readable plan. The Linux update
script:

1. reads the plan from the running app container;
2. records the current image and version;
3. pulls the approved digest;
4. recreates only the app service with the session-driver override;
5. requires healthy database, storage, and worker diagnostics within 60 seconds;
6. rolls back automatically on failure; and
7. updates `.env` only after success.

## Validation

Automated checks cover:

- HTTPS-only manifest configuration
- mandatory digest pinning
- privileged-route denial after enabling a PIN
- wrong-PIN rejection and successful unlock
- authorized settings and protected log access
- consistent backup creation
- profile/database restore across a full app close and reopen
- available-update detection and backup-first approval
- the exact approved plan written for the host
- a failed update service returning an operational error while health remains
  available
- controller-visible Settings diagnostics, administration, backup, and recovery
  controls

The complete formatting, lint, type, test, build, and production-container
checks pass. Live validation covers the operational API and responsive Settings
and Updates screens in the production image.

## Operational References

- [Deployment and recovery runbook](deployment.md)
- [Tailscale Serve command](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Tailscale Funnel](https://tailscale.com/kb/1223/funnel)
- [Docker Compose production deployments](https://docs.docker.com/compose/how-tos/production/)

## Deferred Work

Stage 7 owns concurrent-session authorization, capacity observability, and
failure isolation. Stage 8 owns Firefox add-on management. Functional
implementation remains with Codex; final visual polish remains reserved for the
Claude Opus 5 handoff after those functional stages.
