# Stage 2 Browser Transport

Date: 2026-07-28

Decision: Selkies passes the Stage 2 technical gate. MediaDeck will use its
single-port WebSocket transport by default and retain WebRTC as an optional
future mode behind the same browser-worker interface.

## Pinned Worker

The Stage 2 worker uses:

```text
ghcr.io/linuxserver/firefox@sha256:e4b9310d76fbaef54de9b6a440113729c442125f50668ad9e9f678c0af1ae700
```

Observed image metadata:

- architecture: `amd64`
- image build date: 2026-07-25
- LinuxServer image version: `1153.0build1-1xtradeb1.2404.1-ls111`
- Firefox: 153.0
- local image size reported by Docker: approximately 1.09 GB

LinuxServer's Firefox image is based on Selkies and includes the display,
audio, input, and Firefox runtime needed by one browser worker. The digest is
pinned so upstream changes cannot silently alter a deployment.

## Why WebSocket Is the Default

Current Selkies supports a WebSocket transport through one web endpoint.
Containerized WebRTC normally adds host networking or TURN and UDP firewall
requirements. MediaDeck already uses a trusted Tailscale HTTPS proxy, so the
WebSocket mode has the smaller deployment and failure surface for v1.

This is an implementation choice, not a permanent API assumption. The shared
health response identifies both `provider` and `mode`, and later session APIs
will use opaque session IDs.

## Spike Results

| Check                      | Result                 | Evidence or follow-up                                                                                             |
| -------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Headless container startup | Pass                   | Worker started under Docker Desktop's Linux VM with no host desktop                                               |
| Firefox rendering          | Pass                   | Firefox 153 rendered through the Selkies canvas                                                                   |
| YouTube playback           | Pass                   | Big Buck Bunny played continuously in remote Firefox                                                              |
| Codec path                 | Pass                   | YouTube reported AV1 video (`av01`) and Opus audio                                                                |
| Audio path                 | Pass                   | Firefox created an active, unmuted PulseAudio sink input; Selkies logged its first non-silent Opus chunk          |
| Pointer input              | Pass                   | Remote search field accepted focus and clicks                                                                     |
| Keyboard input             | Pass                   | Individual key events entered and cleared text in remote Firefox                                                  |
| Reconnect                  | Pass                   | Closing and reopening the client retained Firefox, playback position, and page state                              |
| Software encoding          | Pass                   | `x264enc`, 60 fps worker target, 12 Mbps configured ceiling                                                       |
| Touch input                | Manual follow-up       | The in-app automation surface cannot synthesize CDP touch events; validate on the target tablet/phone             |
| Gamepad input              | Manual follow-up       | Selkies created four virtual Xbox gamepads; physical controller behavior belongs to Stage 4 validation            |
| Widevine DRM               | Manual follow-up       | Firefox x64 Linux supports on-demand Widevine, but protected playback was not proven in this Windows-hosted spike |
| Intel/AMD GPU path         | Configured, unverified | Linux-only `/dev/dri/renderD128` override is provided                                                             |
| NVIDIA GPU path            | Deferred               | Requires host-specific drivers/runtime and representative hardware                                                |

During the extended playback sample, YouTube reported:

- viewport: 880 by 495
- current/optimal resolution: 854 by 480 at 30 fps
- dropped frames: 38 of 8,801, approximately 0.43%
- connection estimate: approximately 108 Mbps on the local Docker path
- buffer health: approximately 122 seconds

These are development-host observations, not production capacity guarantees.

## Resource Observation

The production-style Windows/Docker Desktop sample with active video reported:

- CPU: 0.74 logical core
- memory: 0.92 GiB
- processes/threads reported by Docker: approximately 500
- local network transfer at the sample point: approximately 10 MB in each
  direction

The committed worker explicitly sets `START_DOCKER=false`; process inspection
confirmed that neither `dockerd` nor `containerd` was running. Capacity and
bandwidth must be measured again on the headless Linux host before enabling
concurrent sessions.

Startup and pointer/keyboard response were interactive on the local host. The
HTTP shell became available approximately three seconds after Compose began
recreating the cached worker, and the Firefox canvas was visible about six
seconds after client navigation. A meaningful end-to-end latency number
requires the real tailnet, client hardware, and Linux host, so this report does
not invent one.

## Security Posture

The spike configuration:

- binds HTTP and HTTPS ports to `127.0.0.1`
- disables the microphone, clipboard, commands, file transfer, and sharing
- hides and locks the generic Selkies sidebar
- disables the image's nested Docker daemon
- uses `no-new-privileges`
- persists only `/config`
- leaves public exposure to the trusted HTTPS proxy

Selkies currently falls back to its transfer defaults when given an empty or
`none` list. The worker therefore allows only `download` at the Selkies layer
while `HARDEN_DESKTOP` removes the download route, which disables both upload
and download in combination.

The worker is not an authentication boundary. Stage 3 must route clients
through an authorized session rather than expose a long-lived shared worker
URL.

## Known Limitations

- A non-fatal wake-lock permission error appeared in the HTTP localhost test.
  Recheck through the production HTTPS origin.
- The Windows host can validate the Linux container path but not native Linux
  device access or production resource behavior.
- YouTube selecting AV1 proves that codec path, not every codec or DRM service.
- Touch, physical controllers, Widevine, and GPU acceleration remain explicit
  hardware/release checks.

## Stage 3 Boundary

Stage 2 deliberately does not create or delete workers dynamically. Stage 3
will introduce a session manager that owns:

- one worker identity per session
- exclusive profile-directory locks
- ephemeral Guest directories and cleanup
- health, reconnect, timeout, and crash recovery
- opaque client session routing
- a future configurable concurrency ceiling

The `GET /api/v1/browser-worker/health` endpoint is the first
transport-neutral seam. It reports availability and capabilities without
exposing a container name or requiring callers to understand Selkies.

## References

- [LinuxServer Firefox image](https://docs.linuxserver.io/images/docker-firefox/)
- [LinuxServer Selkies base image](https://github.com/linuxserver/docker-baseimage-selkies)
- [Selkies getting started](https://selkies-project.github.io/selkies/start/)
- [Selkies components and transports](https://selkies-project.github.io/selkies/component/)
- [Selkies firewall guidance](https://selkies-project.github.io/selkies/firewall/)
- [Mozilla Firefox DRM guidance](https://support.mozilla.org/en-US/kb/enable-drm)
