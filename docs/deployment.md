# Deployment

The production target is a small headless Linux Docker host reachable only
through its Tailscale tailnet. MediaDeck itself listens on loopback; Tailscale
Serve terminates HTTPS and proxies the application and stream WebSockets.

## Start MediaDeck

Copy the example environment, set the Docker socket group, then build and start
the production service:

```shell
cp .env.example .env
stat -c '%g' /var/run/docker.sock
# Put the reported number in DOCKER_GID within .env.
docker compose -f compose.yaml -f compose.sessions.yaml up --build -d
```

MediaDeck listens on `127.0.0.1:8080` by default. Binding to loopback prevents
clients from bypassing the trusted HTTPS proxy.

Check service status:

```shell
docker compose ps
curl --fail http://127.0.0.1:8080/healthz
```

The health endpoints are:

- `GET /healthz`
- `GET /api/v1/health`
- `GET /api/v1/browser-worker/health`
- `GET /api/v1/operations/diagnostics`

## Start Profile-Aware Browser Workers

The profile-aware worker driver is enabled by the production command above:

```shell
docker compose -f compose.yaml -f compose.sessions.yaml up --build -d
```

MediaDeck creates a worker only when a session is requested. Each worker:

- runs Firefox 153 in the pinned LinuxServer Selkies image
- uses Intel/AMD DRI hardware encoding when the configured render node is
  available, with automatic software fallback
- mounts only its persistent profile or temporary Guest subdirectory
- disables the microphone, clipboard, command execution, sharing, and the
  image's nested Docker daemon; file transfer is download-only
- has no host-published port
- is labeled and named by an opaque session UUID
- has explicit CPU, memory, PID, and shared-memory ceilings

On the first browser launch, MediaDeck checks whether the exact digest-pinned
worker image is present and pulls it through the local Docker Engine when it is
missing. The first launch can therefore take several minutes on a slower
connection. Concurrent launch requests share the same pull instead of
downloading the image more than once. A registry or network failure is reported
in the launch error and can be retried without restarting MediaDeck.

The application talks to the local Docker Engine over its Unix socket. Access
to that socket is equivalent to administrative control of the Docker host.
Keep MediaDeck private, patch it promptly, and do not expose the API outside the
trusted Tailscale path. A dedicated least-privilege worker manager remains a
future hardening option.

The Stage 2 `compose.browser-spike.yaml` override remains a diagnostic tool. Do
not run it together with `compose.sessions.yaml`.

## Profile and Session APIs

Profiles:

- `GET /api/v1/profiles`
- `POST /api/v1/profiles`
- `GET /api/v1/profiles/:profileId`
- `PATCH /api/v1/profiles/:profileId`
- `DELETE /api/v1/profiles/:profileId`

Sessions:

- `GET /api/v1/capacity`
- `GET /api/v1/sessions`
- `POST /api/v1/sessions`
- `GET /api/v1/sessions/:sessionId`
- `POST /api/v1/sessions/:sessionId/heartbeat`
- `POST /api/v1/sessions/:sessionId/recover`
- `POST /api/v1/sessions/:sessionId/stop`

Applications:

- `GET /api/v1/applications`
- `POST /api/v1/applications/youtube/launch`

Operations:

- `GET /api/v1/admin/status`
- `POST /api/v1/admin/unlock`
- `POST /api/v1/admin/lock`
- `PUT /api/v1/admin/pin`
- `GET/PATCH /api/v1/settings`
- `GET /api/v1/operations/diagnostics`
- `GET /api/v1/operations/logs`
- `GET /api/v1/operations/resources`
- `POST /api/v1/operations/reconcile`
- `GET/POST /api/v1/backups`
- `DELETE /api/v1/backups/:backupId`
- `POST /api/v1/backups/:backupId/restore`
- `GET /api/v1/updates/status`
- `POST /api/v1/updates/check`
- `POST /api/v1/updates/approve`

Active session streams are available beneath the session-scoped
`/stream/<session-uuid>/` path. MediaDeck proxies both HTTP assets and WebSocket
traffic to the isolated worker. Public responses expose the opaque session ID,
application ID, lifecycle status, and stream path, never the Docker container
ID, internal address, or storage path.

Launch requests include a random session access token. Lifecycle requests must
send that same value in `X-MediaDeck-Session-Token`. The controller handles
this automatically and keeps the token in tab-scoped `sessionStorage`.
Successful launch sets an HttpOnly cookie scoped to the stream path so HTTP
assets and WebSocket upgrades authenticate without a token in the URL.
Production Compose also marks this cookie Secure. Set
`SESSION_COOKIE_SECURE=false` only for direct local HTTP development; the
headless deployment keeps it enabled behind Tailscale Serve HTTPS.

## Tailscale Serve

After Tailscale and tailnet HTTPS are configured on the Linux host, proxy the
local MediaDeck service:

```shell
tailscale serve --bg 8080
```

Confirm the active private proxy and the loopback-only Docker publication:

```shell
tailscale serve status
ss -ltn | grep '127.0.0.1:8080'
```

The resulting `https://<machine>.<tailnet>.ts.net` URL is available to devices
allowed by the tailnet policy. Restrict access to the intended users or device
tags in the Tailscale policy. Do not enable Tailscale Funnel: Funnel exposes a
service to the public internet, while Serve is tailnet-only. `TRUST_PROXY`
remains `false` because Stage 6 does not consume proxy identity headers.

Current syntax and behavior are documented in
[Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) and
[Tailscale Funnel](https://tailscale.com/kb/1223/funnel).

## Configuration

Copy `.env.example` to `.env` to override Compose values. Environment values
are validated at application startup; invalid values stop startup with an
error.

Common settings:

| Variable                        | Default           | Purpose                                                  |
| ------------------------------- | ----------------- | -------------------------------------------------------- |
| `MEDIADECK_PORT`                | `8080`            | Loopback port exposed by Compose                         |
| `MEDIADECK_IMAGE`               | `mediadeck:0.1.0` | Local or digest-pinned release image                     |
| `MEDIADECK_UPDATE_MANIFEST_URL` | unset             | HTTPS release manifest; empty disables update checks     |
| `APP_VERSION`                   | `0.1.0`           | Version reported by health/config endpoints              |
| `LOG_LEVEL`                     | `info`            | Structured application log level                         |
| `SESSION_COOKIE_SECURE`         | `true`            | HTTPS-only stream authorization cookie                   |
| `TRUST_PROXY`                   | `false`           | Fastify proxy trust; enable only for a verified topology |

Browser-worker settings are listed in `.env.example`. A fresh deployment starts
at the Balanced preset (30 FPS / 6 Mbps). Settings provides four presets:

| Preset       | Frame rate | Video ceiling |
| ------------ | ---------- | ------------- |
| Data saver   | 30 FPS     | 3 Mbps        |
| Balanced     | 30 FPS     | 6 Mbps        |
| Smooth       | 60 FPS     | 6 Mbps        |
| High quality | 60 FPS     | 12 Mbps       |

The environment frame-rate and bitrate select the initial preset when no
administrator settings have been saved. Later changes are made in Settings and
apply to newly created Firefox sessions. MediaDeck requires active sessions to
be stopped before changing the preset.

For production session workers, `BROWSER_WORKER_GPU_MODE=auto` attempts the
configured Linux Intel/AMD DRI render node and falls back to software only when
the device is absent or inaccessible. Use `software` to force CPU encoding or
`dri` to require the device and fail instead of falling back. NVIDIA requires a
host-specific design. `compose.browser-gpu.yaml` remains only for the Stage 2
diagnostic worker and must not be combined with `compose.sessions.yaml`.

`MAX_BROWSER_SESSIONS` defaults to `1`.
`BROWSER_SESSION_IDLE_TIMEOUT_SECONDS` defaults to `1800`; clients keep an
active session alive through the heartbeat endpoint.

For concurrent profiles, size the host first and then raise
`MAX_BROWSER_SESSIONS`. The default per-worker ceilings are:

| Variable                    | Default               | Purpose                       |
| --------------------------- | --------------------- | ----------------------------- |
| `BROWSER_WORKER_CPUS`       | `2`                   | Maximum CPU cores per worker  |
| `BROWSER_WORKER_MEMORY_MB`  | `2048`                | Memory and total memory+swap  |
| `BROWSER_WORKER_PIDS_LIMIT` | `512`                 | Maximum worker process count  |
| `BROWSER_WORKER_SHM_MB`     | `1024`                | Firefox shared-memory size    |
| `BROWSER_WORKER_GPU_MODE`   | `auto`                | `auto`, `software`, or `dri`  |
| `BROWSER_DRI_DEVICE`        | `/dev/dri/renderD128` | Intel/AMD render device       |
| `BROWSER_FRAMERATE`         | `30`                  | Initial stream frame rate     |
| `BROWSER_VIDEO_BITRATE`     | `6`                   | Initial video ceiling in Mbps |

Capacity is visible before launch. Settings shows protected per-session CPU,
memory, process, network, GPU-mode, and encoded-bandwidth data. Network values
are cumulative Docker counters; GPU reporting identifies the actual worker mode
and device rather than vendor-specific utilization.

## Persistent Data

The named Docker volume `mediadeck-data` is mounted at `/data`:

```text
/data/
  addons/
    inbox/
      <profile-uuid>/
    rejected/
      <profile-uuid>/
  backups/
    <backup-id>/
      manifest.json
      database/mediadeck.sqlite
      profiles/
  database/
    mediadeck.sqlite
  profiles/
    <profile-uuid>/
      firefox/
        mediadeck/
          addons/
          policy/
  runtime/
    approved-update.json
    restore-request.json
    guests/
      <session-uuid>/
        firefox/
```

The application creates missing directories on startup. Do not mount the same
persistent Firefox profile into more than one future browser worker.

The container runs as an unprivileged user with a read-only root filesystem.
Only `/data` and the temporary `/tmp` filesystem are writable.

## Managed Firefox Add-ons

Open Settings from a persistent profile to install a Mozilla-signed `.xpi`,
enable or disable it, remove it, or install a newer package with the same
Firefox extension ID. Guest is temporary and has no add-on inventory.

Stop the selected profile's active stream before changing add-ons. MediaDeck
preflights ZIP structure, manifest fields, an explicit Firefox ID, release
signature artifacts, package size, and compatibility with
`FIREFOX_MAJOR_VERSION`. The pinned release Firefox performs final
cryptographic signature verification at launch.

Enabled packages become `force_installed`; disabled packages become `blocked`.
The generated profile-specific policy is mounted read-only at
`/etc/firefox/policies`, separately from the writable Firefox profile.
Operators cannot upload arbitrary policy JSON.

`PUID` must remain `1000`. The MediaDeck application runs as UID 1000 and
shares each profile volume with its Firefox worker; a different worker UID
would take ownership of persistent files away from the application. `PGID` may
still match the operator's preferred host group. Startup rejects a different
PUID instead of allowing a deployment that later loses access to its profiles.

Add-on configuration defaults are:

| Variable                       | Default | Purpose                                   |
| ------------------------------ | ------- | ----------------------------------------- |
| `FIREFOX_MAJOR_VERSION`        | `153`   | Compatibility target; match worker image  |
| `ADDON_MAX_PACKAGE_MB`         | `25`    | Maximum accepted XPI size                 |
| `ADDON_WATCH_ENABLED`          | `false` | Periodically scan watched profile folders |
| `ADDON_WATCH_INTERVAL_SECONDS` | `60`    | Watch scan interval when enabled          |

For optional watched imports, copy packages to:

```text
/data/addons/inbox/<profile-uuid>/*.xpi
```

Enable periodic imports with `ADDON_WATCH_ENABLED=true`, or choose **Scan
folder** in Settings for an immediate scan. Valid packages are imported and
removed from the inbox. Invalid, incompatible, or non-newer packages move to
`/data/addons/rejected/<profile-uuid>/` beside an `.error.json` reason.
Folders that do not match a current profile are ignored.

The inventory API is `GET /api/v1/profiles/<profile-id>/addons`. Install,
enable/disable, remove, and watched-scan routes are administrator-protected
when a PIN is configured.

## Administrator Operations

Settings can enable a 4–12 digit administrator PIN. MediaDeck stores only a
randomly salted scrypt hash. Successful unlocks issue a memory-only bearer
token that expires after 15 minutes; five incorrect attempts from one client
are paused for 15 minutes.

When the PIN is enabled, sensitive settings, profile deletion, backup changes,
restore scheduling, recovery reconciliation, update checks, and update
approval require an unlocked administrator session. Normal profile selection
and streaming do not. If no PIN is configured, tailnet access remains the
security boundary.

The Settings screen exposes service, worker, database, storage, session, and
backup health without requiring shell access. The protected operations log
retains the newest 500 lifecycle and administration events.

## Backups and Restore

Backups require all browser sessions to be stopped. MediaDeck uses SQLite's
online backup API and copies the persistent Firefox profile directories into
an atomic backup directory. Guest and other reconstructible runtime data are
excluded. Retention is configurable from 1 to 20 backups.

Restoring from Settings writes a validated request and asks for a restart:

```shell
docker compose -f compose.yaml -f compose.sessions.yaml restart app
```

Before opening SQLite, startup validates the selected manifest, swaps the
database and profile directory, rolls the filesystem swap back if it fails,
then records the completed restore. Keep an additional host or storage-level
copy of the named volume for disaster recovery.

## Approved Updates

`MEDIADECK_UPDATE_MANIFEST_URL` must be HTTPS. A valid manifest has this form:

```json
{
  "schemaVersion": 1,
  "version": "0.2.0",
  "image": "ghcr.io/example/mediadeck@sha256:<64 lowercase hex characters>",
  "publishedAt": "2026-07-28T12:00:00.000Z",
  "releaseNotesUrl": "https://example.invalid/releases/0.2.0"
}
```

MediaDeck rejects tags without a digest, redirects, invalid fields, and
non-HTTPS release-note links. Automatic checks run on startup and every six
hours when enabled. They never install an image.

To update:

1. Open Updates, run or review the check, and approve the exact release.
2. Approval refuses active sessions, creates a backup, and writes the pinned
   plan beneath `/data/runtime`.
3. On the Linux host, run:

   ```shell
   ./scripts/apply-approved-update.sh .
   ```

4. The script reads the approved plan from the running container, pulls the
   exact digest, recreates only the app service, waits for healthy database,
   storage, and worker diagnostics, and persists the new image/version to
   `.env`.

The host replaces the container because an application should not silently
replace itself through its Docker socket. Docker likewise documents that a
Compose deployment is updated by recreating the affected service; see
[Use Compose in production](https://docs.docker.com/compose/how-tos/production/).

The script records the prior image and version in
`.mediadeck-update-rollback`. If the new container does not become healthy, it
automatically recreates the prior image. For a later manual rollback:

```shell
set -a
. ./.mediadeck-update-rollback
set +a
docker compose -f compose.yaml -f compose.sessions.yaml up -d --no-build app
```

If a forward migration prevents the prior image from booting, run the approved
new image, restore the approval backup from Settings, restart to apply it, and
then recreate the prior image. Never delete `mediadeck-data` during rollback.

## Stop MediaDeck

Stop the services without deleting persistent data:

```shell
docker compose down
```

The named volume is intentionally retained. Back it up before updates or
manual maintenance.

Graceful shutdown stops and removes active dynamic workers before Compose
removes the application network. Guest directories are deleted during that
shutdown. After an ungraceful host or application failure, startup
reconciliation finishes interrupted stops or recovers active workers.
