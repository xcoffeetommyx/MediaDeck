# Stage 8: Firefox Add-on Management

Status: Complete (2026-07-28)

## Delivered

Stage 8 adds a constrained managed-extension layer without turning MediaDeck
into a general-purpose policy editor:

- per-profile add-on inventory stored in SQLite
- raw `.xpi` upload from the controller-accessible Settings screen
- install, enable, disable, remove, and newer-version update flows
- persistent packages stored only inside the selected Firefox profile
- no persistent add-ons for Guest
- optional profile-scoped watched directories
- rejected-package quarantine with machine-readable error details
- administrator protection for mutations when a PIN is enabled
- operation-log events for add-on changes and rejected watched packages

The database schema is version 6.

## Package Safeguards

The API accepts only bounded ZIP-format Firefox WebExtensions. Before storage,
it validates:

- one root `manifest.json`
- no encrypted, ZIP64, unsafe-path, or unsupported manifest entries
- Manifest V2 or V3 with a supported version string
- an explicit Gecko extension ID
- a Mozilla release-signature artifact
- declared Firefox minimum and maximum versions against Firefox 153
- a size no greater than `ADDON_MAX_PACKAGE_MB`

Themes are outside this release. Replacing an existing ID requires a strictly
newer version; byte-identical retries are idempotent. Release Firefox performs
the final cryptographic signature check when consuming the policy.

## Isolation and Policy Model

Metadata is keyed by `(profile_id, addon_id)`. Packages and policy files live
beneath:

```text
/data/profiles/<profile-uuid>/firefox/mediadeck/
  addons/
  policy/policies.json
```

The normal profile remains writable at `/config`. Its policy directory is a
second, read-only Docker volume subpath mounted at `/etc/firefox/policies`.
Enabled add-ons use Firefox `ExtensionSettings` with `force_installed`, a
profile-local `file://` URL, and browser-managed updates disabled. Disabled
add-ons use `blocked`.

MediaDeck rewrites only this generated policy document; users cannot submit
policy JSON. Any mutation is refused while that profile owns an active worker.
Different profiles can retain independent inventories and can stream
concurrently with their own policy mounts.

## Watched Directory

Watched packages use:

```text
/data/addons/inbox/<profile-uuid>/*.xpi
```

`ADDON_WATCH_ENABLED=true` enables periodic scanning at
`ADDON_WATCH_INTERVAL_SECONDS`; Settings also provides a manual scan. Invalid
or incompatible packages move beneath `/data/addons/rejected/<profile-uuid>/`
with an adjacent `.error.json`. Active profiles and unknown profile folders
are skipped safely.

## APIs

- `GET /api/v1/profiles/:profileId/addons`
- `POST /api/v1/profiles/:profileId/addons`
- `PATCH /api/v1/profiles/:profileId/addons/:addonId`
- `DELETE /api/v1/profiles/:profileId/addons/:addonId`
- `POST /api/v1/addons/watch/scan`

Upload bodies use `application/x-xpinstall` and
`X-MediaDeck-Filename: package.xpi`. Mutations follow the existing optional
administrator PIN boundary.

## Validation

Automated validation covers:

- selected-profile package and inventory isolation
- enable, disable, remove, and newer-version updates
- unsigned, malformed, incompatible, and non-newer rejection
- no changes while the profile has an active worker
- watched import and rejected-package quarantine
- API content parsing and structured errors
- Settings inventory rendering and controller-accessible mutation controls
- database migration to schema version 6

The complete formatting, lint, type, 73-test, and production-build gate passes.

Live validation used the pinned production Firefox 153 worker and current
Mozilla-signed uBlock Origin 1.72.2:

- the first profile listed one add-on while a second listed none
- malformed upload returned HTTP 400 without changing inventory
- Docker reported the policy mount read-only
- Firefox registered uBlock Origin as active with `signedState: 2`
- a running profile rejected mutation with HTTP 409
- after stop, disable, and relaunch, policy changed to `blocked` and Firefox
  removed the extension from its registry
- watched import installed the signed package only for the second profile

The disposable containers, image tag, network, volume, and downloaded package
were removed after validation.

## References

- [Firefox enterprise policy templates](https://mozilla.github.io/policy-templates/)
- [Firefox policies.json locations](https://support.mozilla.org/kb/customizing-firefox-using-policiesjson)
- [Firefox WebExtension packaging](https://extensionworkshop.com/documentation/publish/package-your-extension/)
- [Firefox extension signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
- [Firefox extension compatibility and updates](https://extensionworkshop.com/documentation/manage/updating-your-extension/)

## Next Stage

All planned functional stages are complete. Stage 9 is the performance,
reliability, accessibility, visual-consistency, and release pass. Claude Opus
5 is constrained to visual polish by the dedicated handoff document.
