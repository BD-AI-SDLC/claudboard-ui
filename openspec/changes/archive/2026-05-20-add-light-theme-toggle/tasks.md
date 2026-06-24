# Tasks

## 1. Tokens: add semantic tokens for hardcoded colours (capability: web-ui)

- [x] 1.1 In `ui/src/styles/tokens.css`, add to the `:root` (dark) block: `--scrim: rgba(0, 0, 0, 0.5);`, `--ink-on-amber: #1a1300;`, `--ink-on-accent: #ffffff;`, `--ink-on-light: #000000;`
- [x] 1.2 In the `[data-theme="light"]` block, override: `--scrim: rgba(20, 20, 22, 0.32);` (keep `--ink-on-amber`, `--ink-on-accent`, `--ink-on-light` the same — they are designed to be theme-invariant ink colours that sit on theme-invariant chip/button backgrounds)
- [x] 1.3 Sanity-check the token names against the four call-sites listed in §2; rename if any usage is unclear

## 2. Components: route hardcoded colours through tokens (capability: web-ui)

- [x] 2.1 `ui/src/components/RunBanner/RunBanner.css:24,57` — replace `color: #1a1300;` with `color: var(--ink-on-amber);`
- [x] 2.2 `ui/src/components/Project/Project.css:283` — replace `color: #1a1300;` with `color: var(--ink-on-amber);`
- [x] 2.3 `ui/src/components/ReviewGate/ReviewGate.css:18,216` — replace `color: #1a1300;` with `color: var(--ink-on-amber);`
- [x] 2.4 `ui/src/components/Dashboard/Dashboard.css:395` — read surrounding context, replace `color: #000;` with the most accurate token (`--text` if it is body text on a surface, `--ink-on-light` if it is intentionally ink-on-bright-chip)
- [x] 2.5 `ui/src/components/Attach/AttachRepoModal.css:178` — replace `color: #fff;` with `color: var(--ink-on-accent);`
- [x] 2.6 `ui/src/components/Picker/ProjectPicker.css:4` — replace `background: rgba(0, 0, 0, 0.5);` with `background: var(--scrim);`
- [x] 2.7 `ui/src/components/Attach/AttachRepoModal.css:4` — replace `background: rgba(0, 0, 0, 0.5);` with `background: var(--scrim);`
- [x] 2.8 Run `grep -rEn "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(" ui/src --include="*.css" | grep -v tokens.css` and verify zero hits

## 3. Hook: useTheme owns OS-aware state with sticky override (capability: web-ui)

- [x] 3.1 Create `ui/src/hooks/useTheme.ts` exporting a hook `useTheme(): { theme: 'dark' | 'light'; setTheme: (t: 'dark' | 'light') => void }`
- [x] 3.2 Internal state: `systemTheme` (seeded from `window.matchMedia('(prefers-color-scheme: light)').matches`, defaulting to `'dark'` if `matchMedia` is unavailable), `userOverride: 'dark' | 'light' | null` (initially `null`)
- [x] 3.3 Subscribe to `matchMedia('(prefers-color-scheme: light)')` `change` event on mount; update `systemTheme` on each event; clean up listener on unmount
- [x] 3.4 Computed `theme = userOverride ?? systemTheme`
- [x] 3.5 `setTheme(t)` writes `userOverride = t` (which makes the override sticky for the rest of the session)
- [x] 3.6 `useLayoutEffect` writes `document.documentElement.dataset.theme = theme` on every change; use `useLayoutEffect` (not `useEffect`) so the attribute is set before the browser paints, avoiding a dark-flash on first paint when OS prefers light
- [x] 3.7 Unit tests in `ui/src/hooks/__tests__/useTheme.test.ts`: defaults to dark when `matchMedia` is undefined, reads light when OS prefers light, updates on OS change when no override, ignores OS change after override, override is session-scoped (separate `renderHook` calls start fresh)

## 4. App: wire useTheme and pass to Sidebar (capability: web-ui)

- [x] 4.1 In `ui/src/App.tsx`, call `const { theme, setTheme } = useTheme()` at the top of the component
- [x] 4.2 Extend `SidebarProps` in `ui/src/components/primitives/Sidebar.tsx` with `theme: 'dark' | 'light'` and `setTheme: (t: 'dark' | 'light') => void`
- [x] 4.3 Pass `theme={theme}` and `setTheme={setTheme}` from `App.tsx` to `<Sidebar … />`

## 5. UI: theme toggle in sidebar footer (capability: web-ui)

- [x] 5.1 In `ui/src/components/primitives/Sidebar.tsx`, populate the existing `<div className="sidebar__foot" />` with a segmented control: two `<button>` elements wrapped in `<div className="sidebar__theme-tog">`
- [x] 5.2 Moon button: `<Icon name="moon" size={11} />`, `aria-label="Dark"`, `aria-pressed={theme === 'dark' ? 'true' : 'false'}`, `onClick={() => setTheme('dark')}`, class `sidebar__theme-tog-btn` plus modifier `sidebar__theme-tog-btn--on` when active
- [x] 5.3 Sun button: mirror of moon, with `<Icon name="sun" />`, `aria-label="Light"`, calling `setTheme('light')`
- [x] 5.4 Add styles to `ui/src/components/primitives/Sidebar.css`:
  - `.sidebar__theme-tog { display: flex; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 2px; }`
  - `.sidebar__theme-tog-btn { background: transparent; border: 0; padding: 4px 8px; border-radius: 4px; color: var(--muted); cursor: pointer; font-size: 10px; display: grid; place-items: center; }`
  - `.sidebar__theme-tog-btn--on { background: var(--surface-3); color: var(--text); }`
  - `.sidebar__theme-tog-btn:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }`
- [x] 5.5 Verify the toggle is keyboard-reachable: tab order, `Enter`/`Space` activation (requires dev server — manual)
- [x] 5.6 Verify the toggle is present on every screen by opening Dashboard, Project, Kickoff, Active Run, Review Gate in the dev server (requires dev server — manual)


## 6. Lint: forbid raw colour literals outside tokens.css (capability: web-ui)

- [x] 6.1 In `ui/scripts/check-css-prefixes.js`, add a second pass `findHardcodedColors(content)` that scans for `/(#[0-9a-fA-F]{3,8})\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g`, after stripping `/* … */` block comments and `//` line comments
- [x] 6.2 Skip the allowlisted file `ui/src/styles/tokens.css` (compare resolved absolute path)
- [x] 6.3 On any match, print `[css-color] Hardcoded colour "<literal>" found in <file>` to stderr and mark `hasErrors = true`
- [x] 6.4 Update the script's final error message to mention both rules ("All top-level class selectors must contain a hyphen, and colour literals must live in tokens.css.")
- [x] 6.5 Run `npm run lint` and confirm the script passes after the §2 sweep is complete (colour check passes — zero hardcoded colours outside tokens.css; pre-existing class-prefix failures are not introduced by this change)
- [x] 6.6 Add a regression test: temporarily add `color: #ff0000;` to one CSS file, confirm lint fails, revert

## 7. Visual pass: every screen in both themes (capability: web-ui)

- [x] 7.1 Start the dev server (`npm --workspace ui run dev`)
- [x] 7.2 Set OS to light, reload, walk Dashboard / Project / Kickoff / Active Run / Review Gate / ProjectPicker / AttachRepoModal / RunBanner; capture any contrast or token-mismatch issues
- [x] 7.3 Set OS to dark, reload, repeat the walk; confirm nothing regressed
- [x] 7.4 In each theme, click the toggle to flip; confirm immediate repaint, no flash, no missing borders, no invisible icons
- [x] 7.5 Fix any issues found in §7.2–7.4 by adding/extending tokens (not by hardcoding)
- [x] 7.6 Compare side-by-side against `/Users/LUP1BG/Documents/BoschProjects/bosch-workflow/project/claudboard.html` rendered in both themes; flag any palette mismatches against the reference and either match them or document the divergence in `design.md`

## 8. Documentation

- [x] 8.1 Update `ui/src/styles/tokens.css` header comment to document the four new ink tokens and the scrim token
- [x] 8.2 Note in `README.md` (or wherever the UI dev quickstart lives) that the theme respects OS preference and is overridden via the sidebar footer toggle
