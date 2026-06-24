## 1. UI: delete the lower placeholder section from Sidebar.tsx

- [x] 1.1 In `ui/src/components/primitives/Sidebar.tsx`, delete the module-level `LOWER_ITEMS` constant (lines 36–41 — the four-row array literal with `history / skills / rules / settings`). Before deletion, run a workspace grep to confirm no other file references the constant:
  ```bash
  grep -rn "LOWER_ITEMS" ui/ server/ protocol/
  ```
  Expected result: a single match at `ui/src/components/primitives/Sidebar.tsx`. Any other hit is a leak and must be triaged before proceeding.
- [x] 1.2 In the same file, delete the second `<div className="sidebar__section">` block that renders the lower section (lines 194–209). The deletion includes:
  - The opening `<div className="sidebar__section">` tag.
  - The `<div className="sidebar__section-label">Project</div>` line.
  - The entire `{LOWER_ITEMS.map((n) => ( ... ))}` expression and its `<div className="sidebar__item sidebar__item--disabled">` body.
  - The closing `</div>` that pairs with the opening section `<div>` (NOT the `</nav>` that follows it).
- [x] 1.3 After deletion, the JSX inside `<nav className="sidebar__nav">` SHALL contain exactly one `<div className="sidebar__section">` — the Workflow section, with its `Workflow` label and `{navItems.map(renderNavItem)}` body — and nothing else. The TypeScript compiler will catch a mismatched tag; the manual diff review is for visual sanity.
- [x] 1.4 Audit imports at the top of `Sidebar.tsx`:
  - `Icon` — still used by `renderNavItem` (`<Icon name={item.icon} size={14} ... />` at line 164). KEEP.
  - `BrandMark`, `ProjectSwitcher` — used by `sidebar__head`. KEEP.
  - Protocol type imports (`Project`, `Repo`, `Run`, `SpecPlanGateEventPayload`) — used by the surviving nav items. KEEP.
  - The UI package's `tsc` run is the backstop for unused-import drift; rely on it rather than guessing.

## 2. UI: confirm Sidebar.css needs no changes

- [x] 2.1 Re-read `ui/src/components/primitives/Sidebar.css` and confirm that every class used by the now-deleted JSX is still used by the surviving Workflow section. Specifically:
  - `.sidebar__section` — used by the Workflow section wrapper (line 188 of `Sidebar.tsx`, post-deletion).
  - `.sidebar__section-label` — used by the Workflow section's `Workflow` label.
  - `.sidebar__item`, `.sidebar__item:hover`, `.sidebar__item--active`, `.sidebar__item-icon`, `.sidebar__item--active .sidebar__item-icon` — used by every nav item in `renderNavItem`.
  - `.sidebar__item--disabled` — still used by Workflow items in their disabled state. Verify by grep:
    ```bash
    grep -n "sidebar__item--disabled" ui/src/components/primitives/Sidebar.tsx
    ```
    Expected (post-deletion): one match inside `renderNavItem` (the `${disabled ? ' sidebar__item--disabled' : ''}` template expression).
- [x] 2.2 Conclude: **no CSS changes are required.** This is intentional and documented in `design.md` D4. Do not delete any class "to clean up" — every class survives a legitimate use.

## 3. UI: smoke test for non-reintroduction

- [x] 3.1 `ui/src/components/primitives/Sidebar.test.tsx` does not exist on `main` today. Create it from scratch in the same directory as the component (the project's UI test convention is strict co-location — never `__tests__/`). Mirror the imports and mocking style of the nearest existing test (`ui/src/components/Project/Project.test.tsx` is the canonical local reference for `vi.mock('../../api/client.js', ...)` patterns; the sidebar does not call `api` directly but the file structure / imports are the right shape to copy).
- [x] 3.2 Write a single test case (or two — see 3.3) that renders `<Sidebar ... />` with minimal valid props (empty `repos`, empty `runs`, `lastVisitedRepoId: null`, `activeProject: null`, `projects: []`, theme `dark`, and `vi.fn()` for every callback). The render should not throw.
- [x] 3.3 Assertions, all in the same test or split into two for clarity (`renders the Workflow section` and `does not render the legacy "Coming soon" placeholder section`):
  - Negative — the four removed labels are absent:
    ```ts
    expect(screen.queryByText(/^Run history$/)).toBeNull()
    expect(screen.queryByText(/^Skills$/)).toBeNull()
    expect(screen.queryByText(/^Rules$/)).toBeNull()
    expect(screen.queryByText(/^Settings$/)).toBeNull()
    ```
  - Negative — no `.sidebar__section-label` element has text "Project":
    ```ts
    const labels = container.querySelectorAll('.sidebar__section-label')
    expect(Array.from(labels).map(el => el.textContent)).not.toContain('Project')
    ```
    (This is a sharper assertion than `queryByText(/^Project$/)`, because `ProjectSwitcher` may contain the word "Project" in its dropdown — the assertion narrows to the section-label class only.)
  - Positive — the Workflow section is rendered:
    ```ts
    expect(screen.getByText('Overview')).toBeInTheDocument()
    expect(screen.getByText('Workflow')).toBeInTheDocument()
    ```
- [x] 3.4 The test name SHOULD be explicit, e.g. `does not render the legacy "Coming soon" placeholder section`, so a future developer reading a failure understands the intent without spelunking git history.

## 4. Build & verification

- [x] 4.1 From repo root: `npm run typecheck -w ui && npm run lint -w ui && npm run test -w ui`. Typecheck PASS. Lint surfaces pre-existing CSS-prefix failures across `Chip.css`, `Icon.css`, `Meter.css`, `Popover.css`, `Sidebar.css`, `Spark.css`, `TopBar.css` — all reproduce on clean `main` (verified by stashing this change and re-running lint). They are not introduced by this change and are not part of its scope. Tests PASS — all 222 tests across 26 files pass, including the 2 new Sidebar tests.
- [x] 4.2 From repo root: `npm run build`. PASS. Full build (`protocol → server → ui`) completed cleanly. Vite emitted `index-CnF5SiGu.css` (178.14 kB) and `index-D2lU8g8R.js` (440.25 kB) without warnings.
- [x] 4.3 Manual verification using `/run`. Server started via `node server/dist/bin.js` on `http://localhost:3743`, auto-opened in browser. User confirmed the sidebar renders correctly:
  - Single Workflow section with the five real entries; no "Project" header; no Run history / Skills / Rules / Settings rows.
  - Theme toggle, project switcher dropdown, and Workflow disabled-state styling all still work.
  - Screenshot for the PR description is left to the committer.

## 5. PR

- [ ] 5.1 Per the project's per-change branching rule (see `MEMORY.md`), cut a fresh branch off `main`:
  ```bash
  git checkout main && git pull
  git checkout -b chore/remove-coming-soon-sidebar
  ```
  Do NOT bundle this change onto a branch carrying another OpenSpec change.
- [ ] 5.2 Commit using Conventional Commits. Suggested message:
  ```
  chore(ui): remove "Coming soon" placeholder section from sidebar
  ```
  Body briefly notes that the lower section (Run history / Skills / Rules / Settings) was never wired and is being deleted ahead of any real implementation. Reference this OpenSpec change directory.
- [ ] 5.3 Open the PR with the same title. Body links this change directory (`openspec/changes/remove-coming-soon-sidebar/`) and includes the screenshot from §4.3. Reference `remove-kickoff-recent-runs` and `remove-clone-from-git-url` as context for the dead-scaffolding cleanup theme.
- [ ] 5.4 After merge, run `openspec archive remove-coming-soon-sidebar` (or use the `openspec-archive-change` skill) to fold this change into the archived history. There is no `specs/` delta to promote — the archive is a metadata-only move.
