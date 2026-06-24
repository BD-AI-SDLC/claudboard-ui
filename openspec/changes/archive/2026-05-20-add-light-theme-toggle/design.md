## Context

The reference repo at `/Users/LUP1BG/Documents/BoschProjects/bosch-workflow/project` was the source for the entire visual language of this app; its `styles.css` is the file `ui/src/styles/tokens.css` was ported from. The reference also defines a `[data-theme="light"]` token block and a working toggle in `sidebar.jsx:117-124` that writes `document.documentElement.dataset.theme`. When this app's UI was first built, the dark palette was kept and the light palette was carried along as dormant tokens but never wired up.

This change is **scoped strictly to making the existing light palette usable**, not to a richer theming system, persistence, or theme-aware imagery.

## Decisions

### 1. Theme state model — OS-aware default, sticky user override

The hook owns three pieces of state, but only one is exposed:

```
internal state                       exposed
──────────────────────────────────   ───────────
systemTheme: 'dark' | 'light'        theme
  (from matchMedia, updates live)    setTheme
userOverride: 'dark' | 'light' | null
  (null until user clicks toggle)

theme = userOverride ?? systemTheme
```

This gives the behaviour the user asked for: OS preference is the default, an explicit pick wins, and the pick stays the same for the rest of the session even if the OS preference flips. A reload returns to OS preference because `userOverride` lives only in React state, not in `localStorage`.

**Alternative considered:** a tri-state `'dark' | 'light' | 'system'` exposed to the UI, where a "system" mode keeps re-syncing with the OS even after a pick. Rejected for v1 because the toggle is two buttons (moon ↔ sun, matching the design), and a third "auto" state would force a different control shape (segmented three-way, or a separate "follow system" affordance) that isn't in the design. Easy to add later if we want it.

**Alternative considered:** persist the override to `localStorage` so it survives reload. Rejected for v1 per the user's explicit "not relevant for now if it survives" — keeping the change small. The hook is structured so persistence is a one-function-call addition later (`useEffect` syncing `userOverride` to `localStorage`).

### 2. The toggle lives in the sidebar footer, matches reference markup

The Sidebar already renders an empty `<div className="sidebar__foot" />` at the bottom — same placement as the reference's `.side-foot`. We populate it with the same two-button segmented control used in the reference, renamed to fit this project's BEM-y class prefix convention (`sidebar__theme-tog` rather than the reference's `theme-tog`, to satisfy `check-css-prefixes.js`).

```
┌──────────────────────────┐
│  sidebar                 │
│  ┌────────────────────┐  │
│  │ cb claudboard v1.4 │  │
│  └────────────────────┘  │
│                          │
│  Workflow                │
│  • Overview              │
│  • Project · health      │
│  • Start feature         │
│  • Active run            │
│  • Review gate           │
│                          │
│  Project                 │
│  • Run history           │
│  • Skills                │
│  • Rules                 │
│  • Settings              │
│                          │
├──────────────────────────┤
│  ┌───────┬───────┐       │  ← new in this change
│  │   🌙   │   ☀   │       │     sidebar__theme-tog
│  └───────┴───────┘       │     active button highlighted
└──────────────────────────┘
```

The control has no label text — the icons carry the meaning, and `aria-label="Dark"` / `aria-label="Light"` + `aria-pressed` carry the semantics for screen readers. The currently active theme's button is visually distinct (`--on` modifier sets background to `--surface-3` and colour to `--text`).

**Alternative considered:** a single click-to-toggle button that flips between sun and moon. Rejected because the reference shows the segmented form and because the segmented form makes the current state visible at a glance, with one click to switch — same number of clicks, more legibility.

### 3. The `--scrim` token

The modal backdrops in `ProjectPicker.css` and `AttachRepoModal.css` are both `rgba(0, 0, 0, 0.5)`. In light mode a pure-black scrim at 50% opacity looks heavy and breaks the soft palette. We add a `--scrim` token defined in both palettes:

| token     | dark            | light                  |
|-----------|-----------------|------------------------|
| `--scrim` | `rgba(0,0,0,.5)`| `rgba(20,20,22,.32)`   |

The dark value is unchanged from current behaviour. The light value is a slightly tinted dark grey at lower opacity, which veils the background without crushing the surface contrast — verified against the reference's modal treatment.

### 4. Hardcoded-colour lint extension

`ui/scripts/check-css-prefixes.js` already runs as part of `npm run lint` and walks every `.css` file under `ui/src`. We extend it with a second pass that fails on any colour literal (`#rgb`, `#rrggbb`, `rgb(...)`, `rgba(...)`, `hsl(...)`, `hsla(...)`) found outside the allowlisted file `ui/src/styles/tokens.css`. The check is a regex over each line, after stripping single-line and block comments. False positives (e.g. a colour literal inside a comment example) are not expected in current code; if any arise the allowlist can grow to a small set of files rather than a per-line `// css-lint-disable` mechanism — we want the lint to be loud, not configurable.

**Why now:** without this guard, the sweep is one-shot and a future commit can silently reintroduce a hardcoded colour. The lint makes the discipline permanent.

### 5. Amber chip text stays hardcoded

Four CSS rules currently set `color: #1a1300` on text that sits on an amber background (the run-status chip on `RunBanner`, the gate chip on `Project`, two chips on `ReviewGate`). The amber accent in light mode is `oklch(62% 0.14 70)` — still bright enough that `#1a1300` (a very dark warm brown) reads with strong contrast. Replacing this with a token would require either a dedicated `--ink-on-amber` token or pulling from the existing `--text` (which is `#16171a` in light mode — visually equivalent). Decision: leave them as-is for now; the existing CSS-prefix lint extension would flag them, so we add `--ink-on-amber: #1a1300` as a token in both palettes and route the four usages through it. This satisfies the lint and documents the intent ("dark text designed for amber backgrounds"). Same for `--ink-on-accent: #fff` for the white text on accent buttons (`AttachRepoModal.css:178`) and `--ink-on-light: #000` for whatever `Dashboard.css:395` is (to be checked during sweep).

### 6. Visual pass is an explicit task, not an afterthought

Tokens are guesses against the design until verified on every screen. The tasks list contains a per-screen visual-pass checklist that requires opening the screen in both themes and comparing against the reference; any contrast or token issue surfaced is fixed in the same change. This keeps the change closed: "shipped" means "every screen looks right in both themes," not "the toggle works."

## Migration

There is no data migration. The dark palette and all current behaviour are preserved by default for users whose OS preference is dark. Users whose OS preference is light will see the light theme on first load after this ships — this is the intended behaviour and matches the design.

No feature flag is used: the toggle is unconditional, OS-detection is unconditional. Reverting the change means reverting the commit.
