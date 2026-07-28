# UI

## Boot Flow

```text
Select profile
  -> Home
     -> YouTube preview (Stage 5 launch follows)
     -> Settings
     -> Updates
```

## Profile Screen

The profile screen reads persistent profiles from the MediaDeck API. Each card
shows initials and the stored avatar color. Guest is always present and is
clearly labeled as temporary.

When no persistent profiles exist, Guest and Add profile remain available. Add
profile creates the profile through the API, then selects it immediately.

## Home

Home contains three primary tiles:

- YouTube
- Settings
- Updates

The YouTube tile explains that the streaming launch is connected in Stage 5.
Settings reports controller, input, and Firefox-worker readiness. Updates shows
the installed MediaDeck version and the Stage 6 update placeholder.

## Navigation

- D-pad or left stick: move
- A or Enter: select
- B, Escape, or Backspace: back

Mouse and touch use the same native controls. Focus is always represented by a
high-contrast visible ring.

## Responsive Layout

- TV and desktop: large YouTube feature tile with stacked utility tiles
- Tablet: the same spatial two-column layout with fluid typography
- Phone and narrow tablet: vertically stacked tiles and two-column profiles

The interface uses viewport-relative sizing and supports content scrolling on
narrow screens. Directional focus scrolls the next control into view.
