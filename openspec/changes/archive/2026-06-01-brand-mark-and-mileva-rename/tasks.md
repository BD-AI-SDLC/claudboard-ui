## 1. BrandMark primitive

- [x] 1.1 Create `ui/src/components/primitives/BrandMark.tsx`. Props:
  ```ts
  interface BrandMarkProps {
    size?: number              // px, default 20
    variant?: 'default' | 'inverted'  // default 'default'
    className?: string
  }
  ```
  Default variant renders a teal tile with two cells punched out to the surface behind. Inverted variant renders a `--surface-2` tile with teal cells (for use on accent surfaces).
- [x] 1.2 Implementation: render a single `<svg viewBox="0 0 24 24" width={size} height={size}>` wrapped in a `<span class="brand-mark brand-mark--{variant}">`. The wrapper sets `width`/`height`/`border-radius` (24% of `size`) and the tile background via CSS. The SVG contains exactly two `<rect>` elements:
  ```jsx
  <rect x="12" y="5" width="7" height="7" rx="2" className="brand-mark__cell brand-mark__cell--ghost" />
  <rect x="5"  y="12" width="7" height="7" rx="2" className="brand-mark__cell" />
  ```
  The ghost cell has `opacity="0.32"` via CSS (not the SVG attribute) so the inverted variant can override it.
- [x] 1.3 Create `ui/src/components/primitives/BrandMark.css`. Define:
  ```css
  .brand-mark { display:inline-grid; place-items:center; overflow:hidden; flex-shrink:0;
    background: var(--teal); }
  .brand-mark svg { display:block; width:100%; height:100%; }
  .brand-mark__cell { fill: var(--brand-cutout, #08090a); }
  .brand-mark__cell--ghost { opacity: 0.32; }
  .brand-mark--inverted { background: var(--surface-2); }
  .brand-mark--inverted .brand-mark__cell { fill: var(--teal); }
  ```
  `--brand-cutout` is a new CSS custom property; declare a fallback to the existing dark bg colour so the component works even before a light theme defines it.
- [x] 1.4 Add `--brand-cutout: var(--bg);` to the top-level CSS variable block (likely `ui/src/styles.css` or wherever `--teal` is currently defined). Confirm the existing CSS already has a `--teal` token; if not, add it as `oklch(78% 0.13 195)` per the design files. (Quick `grep -n "\\-\\-teal" ui/src/styles.css` to confirm before adding.)
- [x] 1.5 Create `ui/src/components/primitives/BrandMark.test.tsx`. Cover:
  - Renders with default size (20px) and default variant.
  - Renders with a custom `size` prop — wrapper width/height match.
  - Default variant produces wrapper class `brand-mark` only.
  - Inverted variant adds `brand-mark--inverted`.
  - SVG contains exactly two `<rect>` elements with the documented coordinates.
  - `className` prop is appended to the wrapper.
- [x] 1.6 Lint check: all new class names start with `brand-mark` (CSS prefix check passes).

## 2. Sidebar brand block

- [x] 2.1 In `ui/src/components/primitives/Sidebar.tsx` (lines 172–177), replace the brand block:
  ```tsx
  <div className="sidebar__brand">
    <BrandMark size={20} />
    <span className="sidebar__brand-claud">claud</span>
    <span className="sidebar__brand-board">board</span>
    <span className="sidebar__brand-version">v1.4</span>
  </div>
  ```
  Note the lower-case `claud` (was `Claud`) to match the canonical wordmark.
- [x] 2.2 DELETE the immediately following element `<div className="sidebar__brand-tagline">Not for 5 year olds</div>` (line 177).
- [x] 2.3 Add the import `import BrandMark from './BrandMark.js'` at the top of `Sidebar.tsx`.
- [x] 2.4 In `ui/src/components/primitives/Sidebar.css`:
  - `.sidebar__brand`: increase `gap` from `3px` to `9px` to give the glyph air before the wordmark.
  - `.sidebar__brand-claud`: keep `color: var(--text)` (unchanged).
  - `.sidebar__brand-board`: REMOVE `background: #FF9000`, `padding: 1px 5px`, `border-radius: 4px`. Change `color: #000` to `color: var(--teal)`. Keep `font-weight: 700`.
  - DELETE the `.sidebar__brand-tagline` rule entirely.
- [x] 2.5 If `ui/src/components/primitives/Sidebar.test.tsx` exists and asserts on the tagline text or the `Claud` capitalisation, update assertions. If it doesn't exist, skip.
- [x] 2.6 Run `npm run lint -w ui` — CSS prefix check passes (no new prefixes introduced; the brand-mark prefix was registered in section 1).

## 3. Browser tab title + favicon

- [x] 3.1 In `ui/index.html`:
  - Change `<title>Bosch SDLC</title>` to `<title>claudboard</title>`.
  - Inside `<head>`, add: `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`.
- [x] 3.2 Verify `ui/public/` exists; if not, create it. (Vite serves `public/` at the site root by default.)
- [x] 3.3 Create `ui/public/favicon.svg`. Content (single source of truth — keep geometry identical to `BrandMark`):
  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32">
    <rect width="24" height="24" rx="5.76" fill="oklch(78% 0.13 195)"/>
    <rect x="12" y="5" width="7" height="7" rx="2" fill="#08090a" opacity="0.32"/>
    <rect x="5"  y="12" width="7" height="7" rx="2" fill="#08090a"/>
  </svg>
  ```
  Tile radius `5.76` = `24 * 0.24` (same 24% scaling as the inline mark).
- [x] 3.4 Manual smoke (deferred — requires a running dev server): start `npm run dev -w ui`, open the app, confirm the browser tab shows the teal knockout favicon and the title `claudboard`. Test the favicon at the small browser-tab size: the primary cell should still be visually readable; the ghost cell may visually compress at 16px — this is acceptable per the design's "holds from favicon to app icon" guarantee.

## 4. Mileva → Claudboard: setup-utils strings

- [x] 4.1 In `ui/src/components/Project/setup-utils.ts`, update the five `cmd` strings:
  - Line 34: `'/mileva-analyse'` → `'/claudboard-analyse'`
  - Line 35: `'/mileva-generate'` → `'/claudboard-generate'`
  - Line 36: `'/mileva-workflow'` → `'/claudboard-workflow'`
  - Line 40: `'/mileva-refresh'` → `'/claudboard-refresh'`
  - Line 41: `'/mileva-techdebt'` → `'/claudboard-techdebt'`
- [x] 4.2 Do NOT change the `id` field on any op — those are the keys the `prereqs` map is indexed by (`'analyse'`, `'generate'`, `'claudboard-workflow'`, `'refresh'`, `'techdebt'`) and changing them would break the routing through `deriveFoundationStates`, `deriveMaintenanceStates`, `foundationDone`, and the server's prereq state lookup.
- [x] 4.3 Verify `npm run typecheck -w ui` passes.

## 5. Mileva → Claudboard: SetupBanner copy

- [x] 5.1 In `ui/src/components/Project/SetupBanner.tsx` line 52, change `Set up Mileva for this repo` to `Set up Claudboard for this repo`.
- [x] 5.2 Skim the rest of `SetupBanner.tsx` for any other `Mileva` or `mileva` occurrences (grep `mileva` inside the file as a backstop). The `nextOp.cmd` rendered in the button label and subtitle (`Run ${nextOp.cmd}`) automatically picks up the new strings from `setup-utils.ts` — no further code change needed in this file beyond the headline.

## 6. Mileva → Claudboard: test fixtures

- [x] 6.1 In `ui/src/components/Project/SetupBanner.test.tsx`:
  - Replace every occurrence of `'Set up Mileva for this repo'` with `'Set up Claudboard for this repo'` (4 occurrences).
  - Replace every occurrence of `'▶ Run /mileva-workflow'` with `'▶ Run /claudboard-workflow'` (2 occurrences — line 47 and line 57).
  - Replace `'▶ Run /mileva-analyse'` with `'▶ Run /claudboard-analyse'` (line 106).
  - Replace `'▶ Run /mileva-generate'` with `'▶ Run /claudboard-generate'` if present.
- [x] 6.2 In `ui/src/components/Project/OperationCard.test.tsx`:
  - Replace `cmd="/mileva-analyse"` with `cmd="/claudboard-analyse"` (lines 26, 139 — 2 occurrences).
  - Replace `cmd="/mileva-refresh"` with `cmd="/claudboard-refresh"` (line 50).
- [x] 6.3 In `ui/src/components/Project/Project.test.tsx`:
  - Replace `'Set up Mileva for this repo'` with `'Set up Claudboard for this repo'` (lines 128, 152 — 2 occurrences).
- [x] 6.4 Backstop grep: `grep -ri "mileva" ui/src` returns no results.

## 7. Full repo verification

- [x] 7.1 From repo root, run `npm run build`. All three workspaces (protocol → server → ui) build cleanly.
- [x] 7.2 From repo root, run `npm run typecheck && npm run lint && npm test`. All pass. The UI lint includes the CSS prefix check — confirm `brand-mark*` classes pass.
- [x] 7.3 Manual smoke (deferred — requires a running dev server):
  - Start `npm run dev -w ui` (with the server running).
  - Sidebar header shows: teal knockout glyph, then `claud` (text colour) + `board` (teal), then `v1.4` pill. No tagline beneath.
  - Open a project that has not been set up. SetupBanner reads `"Set up Claudboard for this repo"`. The CTA button reads e.g. `▶ Run /claudboard-analyse` and clicking it still triggers the same prereq flow as before (server-side invocation is unchanged).
  - Browser tab shows the knockout favicon and the title `claudboard`.
  - The archived `2026-05-29-foundation-staleness-soft-gate` openspec change is untouched (its `Mileva` references remain — historical record preserved).
