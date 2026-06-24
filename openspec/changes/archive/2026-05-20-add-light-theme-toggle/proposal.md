## Why

The app ships dark-only today, but the reference design in `/Users/LUP1BG/Documents/BoschProjects/bosch-workflow/project` includes a light variant and a per-user toggle in the sidebar footer. The foundation is already in place — `ui/src/styles/tokens.css` defines a complete `[data-theme="light"]` palette ported from the reference, and `ui/src/components/primitives/Sidebar.tsx` renders an empty `.sidebar__foot` container waiting for controls. What is missing is:

- nothing reads or writes `data-theme` anywhere in the codebase (`grep` returns zero matches in `.ts`/`.tsx`), so the light palette is dead code
- no respect for the user's operating-system colour-scheme preference on first load
- no UI control to switch themes
- a handful of hardcoded colours (`#000`, `#fff`, `rgba(0, 0, 0, 0.5)`) in component CSS that would render wrong in light mode and break the design's contrast guarantees

The goal of this change is **the app respects the user's OS colour-scheme preference on first load, and lets the user override it from a toggle in the sidebar footer**. Persistence across reloads is explicitly out of scope for v1 — the override is session-scoped.

## What Changes

- **`useTheme` hook owns theme state.** A new hook at `ui/src/hooks/useTheme.ts` reads `window.matchMedia('(prefers-color-scheme: light)')` on mount, listens to OS-preference changes, and exposes `{ theme: 'dark' | 'light', setTheme }`. The hook writes `document.documentElement.dataset.theme` whenever the value changes. OS-preference changes are honoured **only until the user explicitly picks** a theme; after an explicit pick, the override is sticky for the remainder of the session.
- **Theme state lifted to `App.tsx`.** `App` calls `useTheme()` and passes `theme` and `setTheme` to `Sidebar`. No other component reads or writes theme state — components style themselves via tokens.
- **Sidebar footer hosts the toggle.** The existing empty `.sidebar__foot` in `ui/src/components/primitives/Sidebar.tsx` is populated with a segmented two-button control (moon ↔ sun) styled to match the reference's `.theme-tog`. The reference's `<Icon name="moon" />` / `<Icon name="sun" />` already exist in `ui/src/components/primitives/Icon.tsx`.
- **Landmine sweep.** Four hardcoded-colour usages are replaced with token references so they read correctly in both themes:
  - `Dashboard.css:395` (`color: #000`) → token
  - `AttachRepoModal.css:178` (`color: #fff`) → token
  - `ProjectPicker.css:4` and `AttachRepoModal.css:4` (`background: rgba(0, 0, 0, 0.5)` modal backdrop) → a new `--scrim` token defined in both palettes
  - The four `color: #1a1300` chip-text usages on amber backgrounds (`RunBanner`, `Project`, `ReviewGate`) are kept as-is because the amber accent stays bright enough in light mode that the dark ink reads correctly; verified during the visual pass.
- **CSS-prefix lint extended to forbid raw colours.** `ui/scripts/check-css-prefixes.js` gains a second check: any `#rrggbb`, `#rgb`, `rgb(...)`, `rgba(...)`, or `hsl(...)` literal outside `ui/src/styles/tokens.css` causes the lint to fail. This prevents regression once the sweep is done.
- **Visual pass through every screen in light mode.** Dashboard, Project, Kickoff, Active Run, Review Gate, the two modals (ProjectPicker, AttachRepoModal), and the RunBanner are each opened in light theme and any remaining contrast or token-mismatch issues are fixed.

## Capabilities

### Modified Capabilities

- `web-ui`: Adds the theme state model (OS-aware default + session-scoped user override), the sidebar-footer toggle control, and a colour-token discipline (no raw colour literals outside `tokens.css`).

## Impact

- **No new runtime dependencies.** Uses native `window.matchMedia` and CSS custom properties.
- **No protocol breakage.** Theme is purely a client-side concern; no REST/WS contract changes.
- **No DB schema change.** Theme preference is not persisted in v1.
- **Bundle size impact:** negligible — one small hook, two icon button elements, ~20 lines of CSS.
- **Out of scope** (deferred): persistence of theme override across reloads (`localStorage`), a third "system" mode that re-syncs with OS changes after an override, per-project theme, custom-palette support, density toggle wiring (separate concern), reduced-motion handling.
- **No breaking change to prior changes.** All deltas are additive. The existing dark-mode behaviour is unchanged when the OS preference is dark and the user has not interacted with the toggle.
