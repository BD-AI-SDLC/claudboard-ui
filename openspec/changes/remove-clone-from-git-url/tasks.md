## 1. UI: delete the clone card, form, and state

- [x] 1.1 In `ui/src/components/Import/ImportView.tsx`, narrow the `Step` type alias from `'cards' | 'folder' | 'clone'` to `'cards' | 'folder'` (line 14).
- [x] 1.2 In the same file, delete the three `useState` declarations for `cloneUrl`, `cloneError`, and `cloning` (lines 18-20). The `submitting` and `submitError` state (lines 21-22) belongs to the folder path; KEEP.
- [x] 1.3 Delete the entire `handleClone` async function (lines 39-53).
- [x] 1.4 Delete the second import card JSX — the `<div className="import__card" onClick={() => setStep('clone')}>` block including its inner ico/title/desc/chev (lines 106-115). Stop the deletion immediately before the `</div>` that closes `import__cards` (line 116).
- [x] 1.5 Delete the `{step === 'clone' && (...)}` branch and the entire `import__form-card` JSX inside it (lines 119-144).
- [x] 1.6 Update the add-mode subtitle (lines 88-91). Replace the conditional value `'Open a local folder or clone a git repo to add another project.'` with `'Open a local folder to add another project.'`. The non-add-mode value stays as-is. Decision rationale: see design.md D7.
- [x] 1.7 Audit the remaining import statements at the top of the file (lines 1-5). Expected: `Project`, `api`, `Icon`, `AttachRepoModal` are all still in use after the deletions. The `import './ImportView.css'` side-effect import stays. If `tsc` flags an unused import, remove it; otherwise leave the import list alone.
- [x] 1.8 Final tree shape: the returned JSX should be `TopBar`-like topbar → `import__body` → `<h1>` + subtitle `<p>` → only the `step === 'cards'` branch (now containing just the folder card) when `step === 'cards'`. The `step === 'folder'` early-return block (lines 55-73) is unchanged.

## 2. UI: delete the form-only CSS

- [x] 2.1 Before deleting any CSS, run a workspace grep to confirm each candidate class is referenced only from the now-deleted JSX:
  ```bash
  grep -rn "import__form-card\|import__label\|import__input" ui/
  ```
  Expected result after task 1 is committed: zero matches in any `.tsx` file; the only matches are inside `Import/ImportView.css` itself. Any other hit is a leak — triage before proceeding.
- [x] 2.2 In `ui/src/components/Import/ImportView.css`, delete the class blocks (lines ~125, 135, 141, 153):
  - `.import__form-card`
  - `.import__label`
  - `.import__input`
  - `.import__input:focus`
- [x] 2.3 Re-grep for `.import__hint` and `.import__error`. If either has a remaining `.tsx` reference (e.g. the folder step's `submitError`/`submitting` lines at `ImportView.tsx:63-64`), KEEP that CSS rule. If neither has a remaining reference, delete the corresponding CSS blocks (lines 155, 161). The grep is authoritative — do not delete on memory.
- [x] 2.4 Re-read the surrounding CSS to confirm no blank-line clusters or orphaned comments are left behind. The CSS prefix lint (`ui/scripts/check-css-prefixes.js`, runs in `npm run lint -w ui`) will pass regardless; this step is stylistic only.

## 3. UI: smoke test for non-reintroduction

- [x] 3.1 Create `ui/src/components/Import/ImportView.test.tsx`. Use the mocking pattern from a nearby co-located test — read `ui/src/components/ReviewGate/ReviewGate.test.tsx` for the Vitest + RTL + `vi.fn()` pattern used in this codebase.
- [x] 3.2 Add a `describe('ImportView', () => { ... })` block with five assertions:
  - "does not render the clone-from-git-url card" — render `<ImportView isAddMode={false} onAttach={vi.fn()} onCancel={vi.fn()} />`, assert `screen.queryByText(/clone from git url/i)` is `null`.
  - "does not render a repository URL label" — same render, assert `screen.queryByText(/repository url/i)` is `null`.
  - "does not render a github-placeholder input" — same render, assert there is no `input` with placeholder matching `/github\.com/i` (use `screen.queryByPlaceholderText(/github\.com/i)`).
  - "add-mode subtitle does not mention cloning" — render `<ImportView isAddMode={true} ... />`, assert no element with text matching `/clone/i` is present.
  - "clicking the folder card transitions to the folder browser" — render, fire `click` on the "Open local folder" card, assert the folder browser surface appears (e.g. by finding the `← Back` button or the topbar title "Open local folder").
- [x] 3.3 Test names SHOULD be explicit so a future failure points directly at intent, e.g. `does not render the clone-from-git-url card` rather than `renders correctly`.

## 4. Server: narrow the endpoint, delete the clone helper

- [x] 4.1 In `server/src/registry/routes.ts`, delete the `cloneRepo` function (lines 55-72).
- [x] 4.2 In the `POST /api/projects` handler (lines 108-165):
  - Change the body type annotation (line 109) from `{ root?: string; remoteUrl?: string; mark?: string }` to `{ root?: string; mark?: string }`. Keep `root?: string` optional at the type level for the runtime guard; the protocol type narrows it externally.
  - Delete the mutual-exclusion guard `if (body.remoteUrl && body.root)` (lines 111-113).
  - Delete the entire `if (body.remoteUrl) { ... }` block (lines 117-128).
  - Replace the surviving `else if (body.root) { root = body.root } else { return ... 'root or remoteUrl is required' ... }` ladder (lines 129-133) with a single guard followed by assignment:
    ```ts
    if (!body.root) return void res.status(400).json({ error: 'root is required' })
    const root = body.root
    ```
  - Delete the now-orphaned `let root: string` declaration (line 115).
- [x] 4.3 Audit imports at the top of `server/src/registry/routes.ts` (lines 1-14). Verify by grep within the file that each import has a remaining call site:
  - `spawn` from `node:child_process` (line 3) — used only by deleted `cloneRepo`. DELETE the import line.
  - `existsSync` from `node:fs` (line 4) — used only by the deleted `body.remoteUrl` branch. DELETE.
  - `homedir` from `node:os` (line 5) — used only by the deleted `body.remoteUrl` branch. DELETE.
  - From `node:path` (line 6): `basename` is used by `mapProjectRow` (line 36) and `deriveMark` (line 51) — KEEP. `join` is used only by the deleted `body.remoteUrl` branch — DELETE from the import list.
  - All other imports stay unchanged.
- [x] 4.4 The downstream scan/classify/persist block (lines 135-164) is unchanged. Read it once after the surrounding edits to confirm no variable name (`root`, `scan`, `classified`, `name`, `mark`, `projectId`, `activePaths`) has been collaterally affected.

## 5. Server: delete the obsolete test, add a small replacement

- [x] 5.1 Run a workspace grep to find any other test or source file that references `remoteUrl` in the server tree:
  ```bash
  grep -rn "remoteUrl\|cloneRepo\|clone-workspace" server/
  ```
  Expected hits after task 4 is committed: only `server/src/__tests__/clone-workspace.test.ts` itself. Any other hit must be triaged before proceeding.
- [x] 5.2 Delete `server/src/__tests__/clone-workspace.test.ts` outright.
- [x] 5.3 **Skipped** — `server/src/__tests__/integration.test.ts:353+` already exercises `POST /api/projects` with `{ root }` (the surviving 201 path). The new 400 guard (`'root is required'`) is a one-line trivial check; adding a dedicated test file for it is over-scoped for this change. If a future change wants defence-in-depth, the test-shape from the deleted `clone-workspace.test.ts` (preserved in git history at commit `df1b544`) is a ready template.
- [x] 5.4 Run `npm run test -w server` and confirm: `clone-workspace.test.ts` no longer appears in the report, the new file (if added) passes, and no other server test regresses. **Verified:** server suite shows 25/26 files passing — the deleted file is gone, and the one failing file (`claudboard/__tests__/prompt-templates.test.ts`, 6 failures) is a pre-existing failure on `main` (confirmed by `git stash` + re-run), unrelated to this change.

## 6. Protocol: narrow `CreateProjectRequest`

- [x] 6.1 In `protocol/src/types.ts`, edit `CreateProjectRequest` (lines 156-160):
  - Make `root` required (drop the `?`).
  - Delete the `remoteUrl?: string` line.
  - Keep `mark?: string`.
  Final shape:
  ```ts
  export interface CreateProjectRequest {
    root: string
    mark?: string
  }
  ```
- [x] 6.2 Build the protocol package: `npm run build -w protocol`. This regenerates the `dist/` consumed by `server` and `ui` and surfaces any consumer that constructed a `CreateProjectRequest` with `remoteUrl` (none expected after tasks 1 and 4 are committed).
- [x] 6.3 Run `npm run typecheck` from the repo root. The server and UI `tsc` runs verify there are no remaining `remoteUrl` references at the type level.

## 7. Coordination: warn the two in-flight change proposals

- [x] 7.1 Append a short section to `openspec/changes/workspaces-overhaul/proposal.md` (at the bottom of the file, under a new `## Archival Note` heading):
  ```
  ## Archival Note

  The `{ remoteUrl }` body shape on `POST /api/workspaces` / `POST /api/projects` documented above was REMOVED by `openspec/changes/remove-clone-from-git-url/`. When this change is archived into live specs, the archiver MUST omit `remoteUrl` from the promoted requirements and scenarios, or the removal will be silently re-introduced.
  ```
- [x] 7.2 Append an equivalent note to `openspec/changes/unify-project-concept/proposal.md`:
  ```
  ## Archival Note

  The `{ remoteUrl }` body shape on `POST /api/projects` and the corresponding Import-view scenarios were REMOVED by `openspec/changes/remove-clone-from-git-url/`. When this change is archived into live specs, the archiver MUST drop the `remoteUrl` mentions (specifically the lines flagged in that change's `proposal.md`), or the removal will be silently re-introduced.
  ```
- [x] 7.3 **Skipped** — the proposal note carries the warning by itself; an archiver opens `proposal.md` before promoting, so duplication into `tasks.md` is not load-bearing for discoverability.

## 8. Build & verification

- [x] 8.1 From repo root: `npm run build`. The full sequential build (`protocol → server → ui`) must complete without warnings or errors. **Verified clean** (`✓ built in 1.58s`).
- [x] 8.2 From repo root: `npm run typecheck && npm run lint && npm test`. **Partial:** typecheck passes across all three workspaces; UI test suite is 220/220 green including the new `ImportView.test.tsx`. `npm run lint -w ui` fails on a long-standing list of `primitives/*.css` classes lacking a hyphen — this is pre-existing on `main` and unrelated to the diff (no new violations introduced; `ImportView.css` was already in the failing set). `npm run test -w server` has 6 failures in `claudboard/__tests__/prompt-templates.test.ts` — also reproduced on `main` with the diff stashed, also unrelated.
- [ ] 8.3 Manual verification using `/run`:
  - Start the app: `node server/dist/bin.js`.
  - Open the workspace dropdown → click `+ Add project`. Confirm only one import card is rendered ("Open local folder"). Confirm no "Clone from Git URL" card, no Git URL input, no Clone button anywhere on the page.
  - Click the folder card. Confirm the folder-browser surface appears unchanged. Pick a valid folder and confirm the attach flow still succeeds end-to-end (project appears in the dropdown, becomes active).
  - In a separate tab or terminal, hit `POST /api/projects` with `{ "remoteUrl": "https://github.com/example/foo.git" }` via curl. Confirm response is 400 with body `{ "error": "root is required" }` (the body no longer recognises `remoteUrl`).
  - Capture one screenshot of the post-deletion Import view for the PR description.

## 9. PR

- [x] 9.1 Cut a fresh branch off main per the project's per-change branching rule: `git checkout main && git pull && git checkout -b chore/remove-clone-from-git-url`. Do not bundle this with any other change. **Done** — branch `chore/remove-clone-from-git-url` cut from `main` at commit `4551ec7`.
- [ ] 9.2 Commit using Conventional Commits. Suggested message: `chore: remove clone-from-git-url attach path (supersedes PLAT-26647)`. A single commit is fine — the change is small enough — but a three-commit split (UI, protocol, server + tests) is also acceptable.
- [ ] 9.3 Open the PR titled `chore: remove clone-from-git-url attach path`. Body links this change directory, references the superseded branch `feature/PLAT-26647/remove-clone-git-url` and its commit `5f101a6`, credits the prior PLAT-26647 author for the original UI removal work and the test-shape inspiration, and includes the screenshot from task 8.3. After merge, close the PLAT-26647 branch without merge.
