# Deployment

Stage 1 provides the production container and storage foundation. Firefox
streaming is introduced in Stage 2.

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

## Persistent Data

The named Docker volume `mediadeck-data` is mounted at `/data`:

```text
/data/
  backups/
  database/
  profiles/
  runtime/
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
