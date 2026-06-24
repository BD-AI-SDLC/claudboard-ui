## Why

Two stale brand artefacts make the app look unfinished, and one of them is actively misleading:

1. **No glyph.** The sidebar header is text-only (`Claud` + orange-boxed `board` + `v1.4` + a "Not for 5 year olds" tagline). The new `ui/designs/claudboard Logo.html` design system promotes a glyph mark — the "knockout" tile, picked from `ui/designs/Logo Concepts.html` concept 08 — and a two-tone wordmark in teal. The app currently shows none of it. The browser tab title is still `Bosch SDLC` and there is no favicon at all.

2. **Mileva references in user-facing copy.** `ui/src/components/Project/setup-utils.ts` advertises five operations as `/mileva-analyse`, `/mileva-generate`, `/mileva-workflow`, `/mileva-refresh`, `/mileva-techdebt`. `SetupBanner.tsx` renders "Set up Mileva for this repo". `Mileva` was a working name; the product is `Claudboard`. None of the strings have functional impact — the server already invokes the correct `/claudboard:claudboard-*` plugin commands in `server/src/prereq/cli-runner.ts`. The UI just shows the wrong name.

The two threads share enough surface area (Sidebar.tsx, SetupBanner.tsx, brand copy) that bundling them is cheaper than two passes over the same files.

## What Changes

### Brand: the knockout mark

- New primitive `ui/src/components/primitives/BrandMark.tsx` + `BrandMark.css`. Renders the canonical mark as inline SVG: a `--teal` tile, corner radius 24% of side, two `rect` cells punched out — primary at `(5,12) 7×7 rx=2` opacity 1, ghost at `(12,5) 7×7 rx=2` opacity 0.32. Props: `size?: number` (default 20). The cell colour is theme-aware via a CSS variable (`--brand-cutout`) so the cells reveal whatever surface sits behind the tile — dark bg colour in dark theme, light page colour in light theme. A `variant="inverted"` prop swaps the mark for an accent-surface deployment: `--surface-2` tile with `--teal` cells.

- The component MUST resolve to a static `<svg>` markup (no animation, no JS state) so it can be reused for favicon/tab and embedded contexts.

### Brand: wordmark in two-tone teal

- `ui/src/components/primitives/Sidebar.tsx` (lines 172–177): replace the existing brand block with `<BrandMark size={20} />` followed by `<span class="sidebar__brand-claud">claud</span><span class="sidebar__brand-board">board</span>` and the existing `v1.4` pill. `board` is rendered in `--teal` text, **not** in a coloured box. Lower-case `claud` matches the design files; today's brand uses title-case `Claud`.
- DELETE the `sidebar__brand-tagline` element and its CSS rule ("Not for 5 year olds" tagline goes away).
- In `Sidebar.css`, the `.sidebar__brand-board` rule loses its `background`, `padding`, and `border-radius`; it keeps only the colour (now `--teal`) and font weight. The class survives; only the box styling is removed.

### Brand: browser tab + favicon

- `ui/index.html`:
  - `<title>Bosch SDLC</title>` → `<title>claudboard</title>`.
  - Add `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`.
- New `ui/public/favicon.svg` — the knockout mark as a standalone SVG using the same geometry as the inline `BrandMark`, sized for a 32×32 favicon viewport. Tile is teal, cell cutouts use `#08090a` (dark bg) — favicons render against the browser chrome, which is consistent across light/dark site themes.

### Mileva → Claudboard rename

- `ui/src/components/Project/setup-utils.ts` — rewrite the five `cmd` strings:
  - `/mileva-analyse` → `/claudboard-analyse`
  - `/mileva-generate` → `/claudboard-generate`
  - `/mileva-workflow` → `/claudboard-workflow`
  - `/mileva-refresh` → `/claudboard-refresh`
  - `/mileva-techdebt` → `/claudboard-techdebt`

  These are display strings, not invocation targets. The server's `cli-runner.ts` continues to call the real namespaced plugin commands `/claudboard:claudboard-*`. The short form is for UI affordance; truthfulness is preserved in the server layer.

- `ui/src/components/Project/SetupBanner.tsx` line 52: `Set up Mileva for this repo` → `Set up Claudboard for this repo`.

- Test fixtures track the new strings:
  - `ui/src/components/Project/SetupBanner.test.tsx` — 8 occurrences (`Set up Mileva for this repo` × 4; `▶ Run /mileva-workflow` × 2; `▶ Run /mileva-analyse` × 1; plus one `▶ Run /mileva-generate` in a setup-utils-keyed assertion).
  - `ui/src/components/Project/OperationCard.test.tsx` — 3 `cmd` props (`/mileva-analyse` × 2, `/mileva-refresh` × 1).
  - `ui/src/components/Project/Project.test.tsx` — 2 banner-text assertions.

  All flipped to the new `claudboard-*` and `Claudboard` strings.

### Out of scope

- The archived openspec proposal `2026-05-29-foundation-staleness-soft-gate/` keeps its `Mileva` / `/mileva-*` references — historical records are not rewritten.
- Reworking the actual server CLI invocations (`server/src/prereq/cli-runner.ts`). Those already use the correct namespaced plugin commands; nothing to change.
- The boxed wordmark variant (concept "ph A · Boxed" / "ph C · Mark + box" in `Logo Concepts.html`). We chose the two-tone, no-box lockup (`claudboard Logo.html` hero) per the design's own selection.
- Adopting the knockout mark elsewhere in the app (TopBar, empty states, bootstrap screen, etc.). Sidebar + favicon are the canonical surfaces; other deployments are deferred to focused follow-up changes when a need surfaces.
- A multi-size PNG favicon fallback. Modern browsers handle SVG favicons; if Safari/IE compatibility surfaces later, a PNG can be added without specification work.
- A "light theme" pass for the brand. The component is theme-aware via `--brand-cutout`, but the rest of the app does not yet have a working light theme to verify against.

## Capabilities

### Modified Capabilities

- `web-ui` — extends with the `BrandMark` primitive, the two-tone wordmark, the favicon and tab title, and the Mileva→Claudboard copy rename across the Project setup surfaces.

### New Capabilities

None.

## Impact

- **Protocol (`protocol/src/`):** no changes. No types, no events, no schemas.

- **Server (`server/src/`):** no changes. `prereq/cli-runner.ts` already invokes the canonical `/claudboard:claudboard-*` commands; the UI rename is display-only.

- **Database:** no schema change.

- **UI (`ui/src/`):**
  - New `components/primitives/BrandMark.tsx`, `BrandMark.css`, `BrandMark.test.tsx`.
  - `components/primitives/Sidebar.tsx` — header brand block: add `<BrandMark>`, drop the tagline element, lower-case the `claud` span.
  - `components/primitives/Sidebar.css` — drop tagline rule; strip box styling from `.sidebar__brand-board` (background, padding, border-radius); flip colour to `--teal`.
  - `components/Project/setup-utils.ts` — five `cmd` strings updated.
  - `components/Project/SetupBanner.tsx` — banner headline updated.
  - `components/Project/SetupBanner.test.tsx` — assertions updated to new strings.
  - `components/Project/OperationCard.test.tsx` — fixture cmd props updated.
  - `components/Project/Project.test.tsx` — banner-text assertions updated.

- **UI public assets (`ui/`):**
  - New `index.html` title (`Bosch SDLC` → `claudboard`).
  - New `index.html` favicon `<link>`.
  - New `public/favicon.svg`.

- **Filesystem:** one new asset (`ui/public/favicon.svg`); no other on-disk artifacts.

- **No breaking changes** to external callers, protocol surfaces, or persisted state. All changes are display-layer.
