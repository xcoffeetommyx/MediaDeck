# Stage 4 Controller-First Application Shell

Status: Complete

Completed: 2026-07-28

## Outcome

Stage 4 replaces the repository placeholder with the usable MediaDeck
application shell. It is connected to the Stage 3 profile APIs and establishes
the navigation model that the YouTube experience will inherit in Stage 5.

## Included

### Profile selection

- Loads persistent profiles from `GET /api/v1/profiles`
- Creates a named, color-coded profile through `POST /api/v1/profiles`
- Selects a newly created profile immediately
- Keeps Guest available as a clearly temporary choice
- Provides loading, retry, empty, and service-unavailable states

Selecting a profile in Stage 4 changes MediaDeck application context. It does
not start a Firefox worker yet; worker launch belongs to the Stage 5 YouTube
flow.

### Application views

- Profile picker
- Home screen
- YouTube launch preview
- Settings placeholder with live browser-worker status
- Updates placeholder with the running MediaDeck version

The placeholders establish final navigation and information hierarchy without
pretending that Stage 6 operations are already implemented.

### Controller and focus system

The shell reads the browser Gamepad API continuously while mounted. It supports
standard controller buttons and analog axes:

| Input              | Action                   |
| ------------------ | ------------------------ |
| D-pad / left stick | Move focus               |
| A                  | Select                   |
| B                  | Back                     |
| Arrow keys         | Move focus               |
| Enter / Space      | Native button activation |
| Escape / Backspace | Back                     |

Analog input uses a `0.55` dead zone, a `360 ms` initial repeat delay, and a
`120 ms` held repeat interval. A and B trigger on an edge rather than repeating
while held.

Focus uses the rendered center points of candidate controls to select the best
control in the requested direction. DOM order is the deterministic fallback.
Dialogs restrict navigation to their own controls.

### Responsive and accessible behavior

- Large controls and fluid type for TV-distance readability
- Pointer and touch activation on the same native buttons
- Visible `:focus-visible` treatment
- Semantic headings, regions, status announcements, dialogs, labels, and
  button names
- Reduced-motion support
- Natural vertical scrolling on narrow screens
- No horizontal overflow at validated sizes

## Validation

Automated checks cover:

- Persistent profile loading
- Profile creation request and immediate selection
- Guest fallback during a profile API failure
- Directional keyboard focus
- Back navigation between Settings, Home, and profile selection
- Standard Gamepad A, B, D-pad, and stick mappings
- Analog-stick dead zone
- axe-core semantic accessibility rules

The axe-core color-contrast rule is disabled only in JSDOM because JSDOM cannot
calculate rendered color contrast. Contrast and focus visibility were checked
in the production browser render.

The production Docker app was also exercised against a disposable SQLite
volume:

- Created a profile through the visible UI
- Confirmed the profile survived a container rebuild
- Navigated to Settings and back
- Confirmed zero browser console warnings or errors
- Verified responsive rendering at `1440 x 900`, `768 x 1024`, and
  `390 x 844`
- Confirmed controller-style focus scrolling reaches off-screen phone tiles

## Stage 5 boundary

The YouTube tile is intentionally a preview in Stage 4. Stage 5 will:

- Create or recover the selected profile or Guest browser session
- Route the opaque session stream into MediaDeck
- Show launch, connection, offline, and recovery states
- Maintain session heartbeats while the stream is open
- Stop or release the session through a consistent return flow
