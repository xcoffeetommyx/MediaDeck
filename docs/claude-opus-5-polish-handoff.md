# Claude Opus 5 Visual-Polish Handoff

MediaDeck's functional implementation through Stage 8 and its final functional
hardening pass are complete. This handoff authorizes a visual and
interaction-polish pass only.

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

## Required Verification

Run:

```shell
pnpm validate
docker compose -f compose.yaml -f compose.sessions.yaml config
```

The current baseline is 81 passing tests. Add or update presentation tests only
when markup changes require it; never delete behavioral assertions to make a
polish change pass.

Manually review representative TV, desktop, tablet, and phone sizes. Exercise
every main workflow with keyboard/controller-equivalent navigation and confirm
that focus is always visible, predictable, and returned sensibly after dialogs
or Back navigation. Check loading, empty, error, busy, disabled, healthy,
offline, locked, and capacity-full states. Honor `prefers-reduced-motion`.

## Handoff Back

Return a concise list of files changed, the visual rationale, any accessibility
improvements, screenshots at representative widths, and exact validation
results. Flag any functional change as a proposal rather than implementing it.
