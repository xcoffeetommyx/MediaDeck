# Brave Origin Migration

MediaDeck now uses Brave Origin exclusively. Firefox workers, Firefox launch
configuration, XPI routes, and the Firefox add-on interface have been removed.
Existing Firefox profile directories are deliberately left untouched in the
data volume so upgrading cannot destroy user data; MediaDeck no longer mounts
or reads them.

The worker is built locally as `mediadeck-brave-origin:0.1.0` from a
digest-pinned LinuxServer Brave Origin base. That image contains the i965 and
iHD VA-API drivers plus `vainfo`.

## Broadwell Deployment

Add this line to `.env` on an Intel Broadwell host:

```dotenv
BROWSER_VAAPI_DRIVER=i965
```

Then deploy the new application and worker:

```shell
git pull --ff-only
docker compose -f compose.yaml -f compose.sessions.yaml up --build -d
docker compose -f compose.yaml -f compose.sessions.yaml ps
curl --fail http://127.0.0.1:8090/healthz
```

Use the host port already configured by `MEDIADECK_PORT`; the example above
matches a server using port 8090.

After the update, open Settings and enable **Prevent AV1 playback** under
**Older hardware video mode**. Stop any active Brave session before changing
that setting. New persistent sessions use
`profiles/<profile-id>/brave-origin`; Guest sessions use temporary
`runtime/guests/<session-id>/brave-origin` storage.

Persistent profiles can manage Chrome Web Store extensions from Settings.
MediaDeck accepts a trusted listing URL or extension ID and applies the
selection through Brave's per-profile managed policy on the next launch.
Arbitrary CRX and ZIP uploads are intentionally unsupported. The bundled AV1
compatibility shim remains an internal worker component and appears only when
the compatibility setting is enabled.

Brave launches as a chromeless application window rather than Chromium kiosk
mode. LinuxServer's desktop layer remains responsible for filling the remote
display, while YouTube can enter and leave its own player fullscreen without
competing with a browser-level kiosk fullscreen state.

Settings also provides independent 1080p, 720p, and 480p remote-display
presets. New sessions default to 1080p; lower resolutions reduce the number of
pixels the host must render and encode.
