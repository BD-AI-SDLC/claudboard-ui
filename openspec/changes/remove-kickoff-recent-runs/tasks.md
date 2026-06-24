## 1. UI: delete the Kickoff recent-runs panel

- [x] 1.1 In `ui/src/components/Kickoff/Kickoff.tsx`, delete the `RECENT_RUNS` module-level constant (lines 30-34, the three-row array literal). The constant has no other references in the codebase — confirm with a workspace `grep` for `RECENT_RUNS` before deletion.
- [x] 1.2 In the same file, delete the JSX block that renders the panel (lines ~214-230), including its outer `<div style={{ marginTop: '28px' }}>` wrapper, the `{/* recent runs */}` comment immediately above it, and the trailing closing `</div>` of that wrapper. The deletion ends just before the `</div>` that closes `kickoff__wrap`.
- [x] 1.3 After deletion, verify the file's JSX tree is balanced (TypeScript will catch a mismatched tag at typecheck; the manual diff review is for visual sanity). The final return should be: `TopBar`, `kickoff__page`, `kickoff__wrap` containing only `kickoff__card` and nothing after it.
- [x] 1.4 Audit imports at the top of `Kickoff.tsx`:
  - `Icon` — still used on line 208 (`<Icon name="rocket" size={12} />` inside the submit button). KEEP.
  - `StatusChip` — used only by the deleted JSX. If a workspace `grep` confirms no other reference inside `Kickoff.tsx`, REMOVE the import line.
  - All other imports — unchanged.
  - The UI package's `tsc` run is the backstop for unused-import drift; rely on it rather than guessing.

## 2. UI: delete the panel's CSS

- [x] 2.1 Before deleting any CSS, run a workspace grep for each class name to confirm it is referenced only from the now-deleted JSX:
  ```bash
  grep -rn "kickoff__recent-title\|kickoff__recent-card\|kickoff__recent-row\|kickoff__ticket-chip\|kickoff__recent-name\|kickoff__recent-ago" ui/
  ```
  Expected result after step 1.2 is committed: zero matches in any `.tsx` file; the only matches are inside `Kickoff.css` itself. Any other hit is a leak that must be triaged before proceeding.
- [x] 2.2 In `ui/src/components/Kickoff/Kickoff.css`, delete the six class blocks (and any sub-selectors like `.kickoff__recent-row:last-child`):
  - `.kickoff__recent-title`
  - `.kickoff__recent-card`
  - `.kickoff__recent-row` (plus its `:last-child` variant)
  - `.kickoff__ticket-chip`
  - `.kickoff__recent-name`
  - `.kickoff__recent-ago`
- [x] 2.3 Re-read the surrounding CSS to confirm no blank-line clusters or orphaned comments are left behind. The lint check (`npm run lint -w ui`, includes `check-css-prefixes.js`) will pass either way; this step is for stylistic cleanliness.

## 3. UI: smoke test for non-reintroduction

- [x] 3.1 Open `ui/src/components/Kickoff/Kickoff.test.tsx` if it exists. If it does not exist, create it following the mocking pattern used by the nearest sibling test (read `ui/src/components/Kickoff/` first; if no neighbour, read `ui/src/components/Project/Project.test.tsx` for the `api` mock pattern).
- [x] 3.2 Add a single test case (or extend an existing render-shape test) that renders `<Kickoff projectId="p1" />` with `api.getRepo` mocked to return a minimal valid `Repo` and asserts:
  - `screen.queryByText(/Recent in this repo/i)` is `null`.
  - `container.querySelector('.kickoff__recent-card')` is `null`.
- [x] 3.3 The test name SHOULD be explicit, e.g. `does not render the legacy "Recent in this repo" panel`, so a future developer reading the failure understands the intent without spelunking the change history.

## 4. Build & verification

- [x] 4.1 From repo root: `npm run typecheck -w ui && npm run lint -w ui && npm run test -w ui`. All three must pass. `typecheck` catches any unused-import drift from step 1.4; `lint` runs the CSS prefix check; `test` runs the new smoke assertion plus the existing suite.
- [x] 4.2 From repo root: `npm run build`. The full build (`protocol → server → ui`) must complete without warnings or errors. The Vite build is the final check that no CSS class referenced by the bundle was incorrectly removed.
- [ ] 4.3 Manual verification using `/run`:
  - Start the app: `node server/dist/bin.js`.
  - Open the Kickoff page for at least one repo.
  - Confirm the page ends at the form card. No "Recent in this repo" heading, no ticket rows, no broken whitespace below the submit row.
  - Confirm the live preview (`→ branch:`, etc.) and all form interactions still work — the deletion must not regress anything.
  - Capture a single screenshot of the post-deletion Kickoff page for the PR description.

## 5. PR

- [x] 5.1 Cut a fresh branch off main per the project's per-change branching rule: `git checkout main && git pull && git checkout -b chore/remove-kickoff-recent-runs`.
- [ ] 5.2 Commit using the project's Conventional Commits convention. Suggested message: `chore(ui): remove hardcoded "Recent in this repo" mock from Kickoff`.
- [ ] 5.3 Open the PR titled `chore(ui): remove hardcoded "Recent in this repo" mock from Kickoff`. Body links this change directory and includes the screenshot from step 4.3. Reference the prior `kickoff-shows-real-project-key` change as context for the cleanup theme.
