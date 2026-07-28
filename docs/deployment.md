# Deployment

Stage 3 provides profile-aware Firefox worker lifecycle management on top of
the Stage 2 transport baseline.

## Start MediaDeck

Build and start the production service:

```shell
docker compose up --build -d
```

MediaDeck listens on `127.0.0.1:8080` by default. Binding to loopback prevents
clients from bypassing the trusted HTTPS proxy.

Check service status:

```shell
docker compose ps
docker compose logs app
```

The health endpoints are:

- `GET /healthz`
- `GET /api/v1/health`
- `GET /api/v1/browser-worker/health`

## Start Profile-Aware Browser Workers

Start MediaDeck with the Stage 3 Docker worker driver:

```shell
docker compose -f compose.yaml -f compose.sessions.yaml up --build -d
```

MediaDeck creates a worker only when a session is requested. Each worker:

- runs Firefox 153 in the pinned LinuxServer Selkies image
- uses x264 software encoding by default
- mounts only its persistent profile or temporary Guest subdirectory
- disables the microphone, clipboard, file transfer, command execution,
  sharing, and the image's nested Docker daemon
- has no host-published port
- is labeled and named by an opaque session UUID

The application talks to the local Docker Engine over its Unix socket. Access
to that socket is equivalent to administrative control of the Docker host.
Keep MediaDeck private, patch it promptly, and do not expose the API outside the
trusted Tailscale path. A dedicated least-privilege worker manager remains a
future hardening option.

On Linux, determine the Docker socket group and set it in `.env`:

```shell
stat -c '%g' /var/run/docker.sock
```

```text
DOCKER_GID=<reported-number>
```

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

- `GET /api/v1/sessions`
- `POST /api/v1/sessions`
- `GET /api/v1/sessions/:sessionId`
- `POST /api/v1/sessions/:sessionId/heartbeat`
- `POST /api/v1/sessions/:sessionId/recover`
- `POST /api/v1/sessions/:sessionId/stop`

Public responses expose the opaque session ID and lifecycle status, never the
Docker container ID or storage path.

## Tailscale Serve

After Tailscale and tailnet HTTPS are configured on the Linux host, proxy the
local MediaDeck service:

```shell
tailscale serve --bg 8080
```

Do not use Tailscale Funnel for the default private deployment.

## Configuration

Copy `.env.example` to `.env` to override Compose values. Environment values
are validated at application startup; invalid values stop startup with an
error.

Common settings:

| Variable         | Default | Purpose                                                  |
| ---------------- | ------- | -------------------------------------------------------- |
| `MEDIADECK_PORT` | `8080`  | Loopback port exposed by Compose                         |
| `APP_VERSION`    | `0.1.0` | Version reported by health/config endpoints              |
| `LOG_LEVEL`      | `info`  | Structured application log level                         |
| `TRUST_PROXY`    | `false` | Fastify proxy trust; enable only for a verified topology |

Browser-worker settings are listed in `.env.example`. Keep
`BROWSER_VIDEO_BITRATE` and `BROWSER_FRAMERATE` conservative on small hosts.
The optional `compose.browser-gpu.yaml` override is Linux-only and currently
targets an Intel/AMD render node; NVIDIA requires a host-specific design.

`MAX_BROWSER_SESSIONS` defaults to `1`.
`BROWSER_SESSION_IDLE_TIMEOUT_SECONDS` defaults to `1800`; clients keep an
active session alive through the heartbeat endpoint.

## Persistent Data

The named Docker volume `mediadeck-data` is mounted at `/data`:

```text
/data/
  backups/
  database/
    mediadeck.sqlite
  profiles/
    <profile-uuid>/
      firefox/
  runtime/
    guests/
      <session-uuid>/
        firefox/
```

The application creates missing directories on startup. Do not mount the same
persistent Firefox profile into more than one future browser worker.

The container runs as an unprivileged user with a read-only root filesystem.
Only `/data` and the temporary `/tmp` filesystem are writable.

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
