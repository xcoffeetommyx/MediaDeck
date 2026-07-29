# Claude Opus 5 Visual-Polish Handoff

MediaDeck's functional implementation through Stage 8 and its final functional
hardening pass are complete. This handoff authorized a visual and
interaction-polish pass only.

Status: Complete (2026-07-28)

Baseline commit: `70a5faf fix: harden runtime and recovery paths`

## Objective

Make the existing MediaDeck interface feel cohesive, deliberate, responsive,
and appliance-like across TV, desktop, tablet, and phone layouts. Refine
spacing, typography, visual hierarchy, color, component consistency, focus
states, restrained motion, empty/loading/error presentation, and microcopy
without changing product behavior.

## Allowed Scope

- React presentation markup where semantics and behavior stay equivalent
- CSS, layout, tokens, responsive rules, and visual states
- copy edits that do not alter workflows or promises
- lightweight, reduced-motion-aware transitions
- accessibility improvements that preserve existing behavior
- visual consistency across Profiles, Home, Viewer, Settings, and Updates

## Do Not Change

- API routes or payload contracts
- SQLite schema, storage paths, backups, or migrations
- authentication, authorization, cookies, tokens, or Tailscale assumptions
- session lifecycle, worker launch, Docker mounts, resource limits, or routing
- Firefox policy generation, XPI validation, or add-on behavior
- Guest persistence rules or profile isolation
- controller mappings, focus-engine logic, or Back semantics
- update/recovery behavior
- dependencies unless a visual requirement is impossible without one and the
  owner approves it first

Do not replace working native controls with decorative non-semantic elements.
Do not weaken visible focus, touch targets, contrast, reduced-motion behavior,
or keyboard/controller parity.

## Functional Baseline to Preserve

- profiles and temporary Guest
- YouTube launch, reconnect, fullscreen request, and return
- directional gamepad/keyboard navigation plus mouse and touch
- optional administrator PIN and protected operations
- backups, restore scheduling, diagnostics, updates, and recovery
- concurrent sessions and capacity feedback
- per-profile Firefox add-on install, update, enable/disable, remove, and
  watched-folder scan

---

# What Changed

## Visual Direction

MediaDeck is read from a couch as often as it is administered from a desk. The
existing dark, cinematic treatment was the right instinct; what it lacked was a
_system_. Values were ad hoc — roughly forty one-off greys, six border colors,
and a status palette that only distinguished "good" from "everything else."

The pass established a **calm instrument panel**: one surface ramp, one text
ramp, and a single status vocabulary reused everywhere. Green always means
healthy, amber always means attention, red always means failure, and a
slow-pulsing grey always means "still checking" — in the top bar, on status
cards, in badges, notices, the operations log, and the stream toolbar alike.

## Files Changed

| File                               | Change                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/web/src/styles.css`          | Rebuilt on design tokens; status/empty/loading/disabled states; responsive and accessibility rules |
| `apps/web/src/OperationsViews.tsx` | Status tones, confirmation dialogs, loading skeletons, empty states, copy, encoding repair         |
| `apps/web/src/App.tsx`             | Guest framing, capacity state, busy/disabled semantics, dialog extraction                          |
| `apps/web/src/Modal.tsx`           | New — shared dialog with focus trap, focus restore, and `ConfirmDialog`                            |
| `apps/web/src/dialog-stack.ts`     | New — dialog registry so Back closes the topmost dialog first                                      |

## Design Tokens

`:root` now defines the whole system: a surface ramp (`--canvas` through
`--surface-solid`), three hairline weights, a four-step text ramp, a five-tone
status set with matching soft/line variants, radii, elevation, motion easing and
durations, and control sizing (`--tap-min: 2.75rem`, `--control-height: 3rem`).

Every text token was checked against `--canvas`: the weakest, `--text-quiet`,
measures 5.87:1 (it replaced values as low as 3.6:1). Raw color values now
survive only where they are genuinely one-off artwork — avatar gradients, the
YouTube card, ambient shapes — not as system values.

## Status and Feedback

- **Status cards** gained `warn`, `bad`, and `pending` tones. Previously
  "Needs attention" rendered with the same grey dot as "Checking", so a degraded
  system was indistinguishable from a loading one. Card values are unchanged.
- **Badges** are neutral by default and colored only when the state carries
  meaning. "Manifest needed" and per-worker resource limits no longer render in
  success green.
- **Disabled and busy are now visually distinct.** Every control previously used
  `cursor: wait` at 55% opacity whether it was genuinely disabled or mid-request.
  Disabled is now `not-allowed` at 45%; in-flight actions carry `aria-busy` and
  `cursor: progress`.
- **Toggles** carry their state visually via `aria-pressed`, not by label alone.
- **Notices** use a color plus a left accent rule rather than a generated glyph,
  which assistive technology would otherwise read aloud.
- **Loading**: Settings renders skeleton rows for add-ons, resources, backups,
  and the operations log instead of flashing empty states before data arrives.
- **Empty states** share one deliberate dashed-panel treatment with a bolded
  lead line and a sentence on what to do next.

## Confirmation Dialogs

The four destructive or consequential actions — remove add-on, delete backup,
restore backup, approve update — used `window.confirm()`. On a controller-first
appliance that is a real parity gap: **a native confirm cannot be reached with a
gamepad at all**, and it looks like a developer tool.

They now use a shared `ConfirmDialog` that reuses the existing `Modal`, is
directionally navigable, states exactly what the action will do, and starts
focused on Cancel when the action is destructive. `Modal` was extracted from
`App.tsx` unchanged in behavior, then given focus restore on close.

A small dialog registry (`dialog-stack.ts`) makes Back — Escape, Backspace, or
the controller's B button — close the topmost dialog before it changes view.
This preserves existing Back semantics rather than altering them; it extends the
same rule to dialogs that previously bypassed the app entirely.

## Guest Clarity

Guest is now marked temporary at every point it is visible: a caution-toned
"Temporary" tag on the profile chip, amber "Erased when you leave" on the picker
card, an explanatory line on Home, "Guest · temporary session" on the viewer
state card, and a fuller `aria-label` on the Guest card and chip.

## Accessibility

- The visually-hidden add-on file input was a tab stop that focused nothing
  visible; it is now `tabIndex={-1}` and opened by its adjacent button.
- Focus restores to the triggering control when a dialog closes.
- Dialog focus is set on a timer rather than an animation frame, so a dialog
  opened while the tab is backgrounded still starts with focus inside it.
- Touch targets: modal close 41.6px → 44px; avatar swatch buttons are now a full
  44×44 target. Verified no interactive element under 44px at any tested width.
- Capacity-blocked launch, PIN errors, and manifest-disabled checks are wired
  with `aria-describedby` / `aria-invalid`.
- Destructive row actions have unambiguous labels ("Delete the backup from …")
  instead of repeated bare "Delete".
- Added `prefers-contrast: more` support.

## Motion

The focus lift, hover lift, and arrow nudge moved inside
`prefers-reduced-motion: no-preference`. Previously the reduced-motion rule only
zeroed transition _duration_, so the transform still applied — it just snapped.
The stream loader is deliberately exempt and keeps turning slowly, since it is
the only signal that a launch is still working.

## Responsive

Operations panels now collapse to one column at 1080px and the Home grid at
900px. Previously both held two columns down to 760px, which squeezed operation
cards on tablets. Status cards use `auto-fit` rather than a fixed two-column
grid. The input legend is `position: fixed`, so controller help stays visible on
long Settings pages instead of stranding at the document bottom. Backup and
add-on row actions go full width under 420px.

## Rough Edges Removed

- Repaired UTF-8 mojibake visible in the shipped UI: `Checking packageâ€¦`,
  `Enabled Â· 1 declared permissions`, and `this profileâ€™s active stream`.
- `.addon-row code` referenced `--text-muted`, a variable that was never
  defined, so add-on IDs fell back to inherited color.
- Updates no longer surfaces the raw `Set MEDIADECK_UPDATE_MANIFEST_URL to
enable release checks.` as its headline. It explains the state in product
  terms and keeps the variable name as a `<code>` reference below — diagnostics
  retained, presentation fixed.
- Removed negative-margin layout hacks on notices and the error banner.

---

# Validation

`pnpm validate` passes end to end — format check, lint (`--max-warnings 0`),
TypeScript, tests, and production builds.

**81 tests passing, unchanged from baseline** — 8 config, 9 contracts, 50 API,
14 web. No behavioral assertion was modified or deleted; the axe-core
accessibility check and the dialog focus-trap test both pass against the
extracted `Modal`.

Compose configuration validates for every documented combination:

```shell
docker compose -f compose.yaml config
docker compose -f compose.yaml -f compose.dev.yaml config
docker compose -f compose.yaml -f compose.sessions.yaml config
docker compose -f compose.yaml -f compose.browser-spike.yaml config
docker compose -f compose.yaml -f compose.browser-spike.yaml -f compose.browser-gpu.yaml config
```

(The GPU overlay applies after `compose.browser-spike.yaml`, per its own header.)

## Runtime Size

No dependency was added.

| Bundle | Baseline                  | After                     | Delta         |
| ------ | ------------------------- | ------------------------- | ------------- |
| CSS    | 25.84 kB / 6.95 kB gzip   | 33.67 kB / 8.10 kB gzip   | +1.15 kB gzip |
| JS     | 233.49 kB / 71.35 kB gzip | 239.05 kB / 72.80 kB gzip | +1.45 kB gzip |

Total transferred growth is about 2.6 kB gzip (~3%).

## Live Verification

Checked against the running app and real API at 1920×1080, 1440×900, 820×1180,
390×844, and 320×640:

- No horizontal overflow at any width, down to the declared 320px minimum.
- Automated contrast sweep over every rendered text node (composited against
  actual stacked backgrounds) found no element below its WCAG AA threshold on
  Profiles, Home, Settings, Updates, the viewer, or the dialogs.
- Automated target sweep found no interactive element under 44×44 at any width.
- Dialogs: danger confirmations start focused on Cancel, safe ones on the
  confirm action, Tab wraps inside the dialog, Escape closes the dialog without
  leaving the screen, and focus returns to the triggering button.
- Viewer launch-failure state renders with `role="alert"`, the guest temporary
  eyebrow, and an actionable retry.
- All media queries parse; the reduced-motion loader exemption is in effect.

# Remaining Environment-Only Checks

These need the real Linux host, display, and input hardware and remain operator
validation:

- **Screenshots at representative widths were not captured.** The automation
  browser pane was not displayed during this session, so the page never
  composited frames and screenshot capture timed out. All layout verification
  above was therefore done with DOM geometry and computed-style probes rather
  than by eye. A visual pass on the target display is still worth doing.
- The same hidden-pane limitation means `requestAnimationFrame` never fired, so
  the existing rAF-based `useAutoFocus` in `navigation.ts` could not be
  exercised live. It is unchanged from baseline and covered by tests.
- Physical gamepad focus traversal on the real controller and TV.
- Touch behavior on the actual touchscreen, including the new full-width row
  actions under 420px.
- Reduced-motion and increased-contrast rendering on the target client.
- Font rendering on the TV — the stack relies on Inter with a system fallback
  and ships no web font.
- Document fullscreen behavior on the target client (carried over from Stage 5).

No functional change was made. Nothing in this pass altered API routes, payload
contracts, storage, session lifecycle, authorization, Firefox policy generation,
add-on behavior, Guest persistence rules, controller mappings, or
update/recovery behavior.
