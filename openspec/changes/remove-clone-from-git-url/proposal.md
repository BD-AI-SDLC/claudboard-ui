## Why

The "Add project" flow has two cards: **Open local folder** and **Clone from Git URL**. The clone card was shipped by `workspaces-overhaul` (commit `df1b544`) and survived the `unify-project-concept` rename. End-to-end it consists of a UI card and inline form (`ui/src/components/Import/ImportView.tsx:106-115, 119-144`), a typed request body (`protocol/src/types.ts:156-160` — `CreateProjectRequest.remoteUrl`), an API client method (`ui/src/api/client.ts:28`), a server `git clone` shell-out (`server/src/registry/routes.ts:55-72, 117-128`), and a six-case test suite (`server/src/__tests__/clone-workspace.test.ts`).

The feature does not work for the actual audience and was being torn down already. Concrete problems:

- **No auth.** `cloneRepo()` spawns `git clone <url> <dest>` with `stdio: ['ignore', 'ignore', 'pipe']` and no credential helper, no SSH agent forwarding, no PAT input. Only public-internet URLs succeed. For a Bosch-internal SDLC dashboard, that excludes ~all real target repositories.
- **No progress.** The HTTP request blocks for the full clone duration. The UI shows a static "Cloning…" spinner. The WebSocket infrastructure that already exists for run streaming is not used. `workspaces-overhaul/design.md:81` explicitly punted on this ("there is no progress streaming in v1").
- **60s hard timeout.** `setTimeout(..., 60_000)` in `cloneRepo` kills the child on slow networks or non-trivial repositories. There is no retry, no resume.
- **Hardcoded destination.** Always `~/dev/<basename(url)>`. User cannot choose a path. If `~/dev` is missing or the destination already exists, the response is 409 with no recovery path — the user cannot say "attach the existing folder instead."
- **A partial removal has already shipped to a branch.** `feature/PLAT-26647/remove-clone-git-url` (commit `5f101a6`, 2026-06-04, by Perisa Lukovic) removed the UI card, the form, the `cloneUrl/cloneError/cloning` state, the `handleClone` handler, and the related CSS — and added 9 RTL assertions guarding non-reintroduction. That branch did **not** touch the server, the protocol type, or the test file, so it leaves a UI-less endpoint, an `remoteUrl` field on a public type that nothing constructs, and a test suite covering an unreachable code path. The stated rationale was "simplifying the flow to its primary use case."

This change replaces the partial removal with a single coherent change spanning UI, protocol, and server. The user-facing outcome matches PLAT-26647; the under-the-hood scope is wider so nothing is left dangling.

The "open local folder" path is unaffected. Users who genuinely need to clone first can do so in the terminal that is already open during a Claude Code session and then attach via "Open local folder" — the workflow loses one click, not a capability.

## What Changes

### UI (`ui/src/components/Import/ImportView.tsx`)

- Delete the `'clone'` member of the `Step` union (`ImportView.tsx:14` — narrow it to `'cards' | 'folder'`).
- Delete the `cloneUrl`, `cloneError`, `cloning` `useState` triplet (`ImportView.tsx:18-20`).
- Delete the `handleClone` function (`ImportView.tsx:39-53`).
- Delete the second import card — the entire `<div className="import__card" onClick={() => setStep('clone')}>` block (`ImportView.tsx:106-115`).
- Delete the `step === 'clone'` branch and the entire `import__form-card` JSX inside it (`ImportView.tsx:119-144`).
- Update the add-mode subtitle on `ImportView.tsx:88-91` so it no longer says "Open a local folder or clone a git repo to add another project." Reword to match the surviving single-card flow (e.g. "Open a local folder to add another project.").
- Audit imports after the deletions. The `Project` type import (`ImportView.tsx:3`) and the `api` import (`ImportView.tsx:4`) are still used by the folder path; keep them. `Icon` is used by both cards' icons — verify the remaining `<Icon name="folder" ... />` and `<Icon name="chevR" ... />` calls before deciding. `AttachRepoModal` is used by the folder step; keep it. The UI package's `tsc` run is the backstop for any drift.

### UI (`ui/src/components/Import/ImportView.css`)

- Delete the CSS class blocks that are consumed exclusively by the deleted clone form (`ImportView.css:125, 135, 141, 153`):
  - `.import__form-card`
  - `.import__label`
  - `.import__input`
  - `.import__input:focus`
- Verify by `grep` (see tasks.md §2.1) that `.import__hint` and `.import__error` are NOT exclusive to the clone form before deciding to remove them. The folder step also surfaces submission errors and hints; if so, keep them. The grep is the source of truth.
- Keep the card-related classes (`.import__cards`, `.import__card`, `.import__card-ico`, `.import__card-title`, `.import__card-desc`, `.import__card-chev`) — the surviving folder card still uses them. Confirmed by inspection of `ImportView.tsx:93-104` (the folder card structure).

### UI (`ui/src/components/Import/ImportView.test.tsx`)

This file does not exist on `main` today. It exists only on the PLAT-26647 branch and asserts the absence of the clone surface. This change creates it from scratch (so the PLAT-26647 branch's test work is not lost). The test SHALL:

- Render `<ImportView isAddMode={false} onAttach={vi.fn()} onCancel={vi.fn()} />` and assert no element with text matching `/clone from git url/i` is present.
- Assert no element with text matching `/repository url/i` is present (the deleted form's label).
- Assert no input with placeholder matching `/github\.com/i` is present.
- Render the add-mode variant (`isAddMode={true}`) and assert the subtitle does NOT contain `/clone/i`.
- Assert that clicking the folder card transitions to the folder browser surface (i.e. `step === 'folder'`) — this is the surviving positive path and is the only behaviour the test file actively guarantees beyond the negative assertions.

### Protocol (`protocol/src/types.ts`)

- Remove the `remoteUrl?: string` field from `CreateProjectRequest` (`protocol/src/types.ts:156-160`).
- `root` becomes required (`root: string`), and `mark?: string` is preserved unchanged (it is an unrelated convenience parameter and is consumed by the folder path on the server).

### UI (`ui/src/api/client.ts`)

- No code change. The `createProject` method (`ui/src/api/client.ts:28`) just forwards its body to `POST /api/projects`. After the protocol type narrows, the existing callsite in `ImportView.tsx` (folder path, line 30) — which passes `{ root: path }` — already satisfies the narrowed shape. The deleted callsite (`ImportView.tsx:44`, which passed `{ remoteUrl: ... }`) is removed in §UI.

### Server (`server/src/registry/routes.ts`)

- Delete the `import { spawn } from 'node:child_process'` line if `spawn` is unused elsewhere in the file (verify by grep — current inspection shows it is used only by `cloneRepo`).
- Delete `import { existsSync } from 'node:fs'` if unused elsewhere (same).
- Delete `import { homedir } from 'node:os'` if unused elsewhere (same).
- Delete `import { join }` from `node:path` if unused — the `basename` import stays (used by `mapProjectRow`'s `name` fallback at line 36 and `deriveMark` at line 51).
- Delete the `cloneRepo` function (`server/src/registry/routes.ts:55-72`).
- Narrow the `POST /api/projects` handler (`server/src/registry/routes.ts:108-165`):
  - Replace the body type with `{ root: string; mark?: string }` (no `remoteUrl`).
  - Delete the `remoteUrl && root` mutual-exclusion guard (`routes.ts:111-113`).
  - Delete the `body.remoteUrl` branch (`routes.ts:117-128`).
  - Collapse the `if (body.root) / else` ladder (`routes.ts:129-133`) into a single 400 guard: `if (!body.root) return void res.status(400).json({ error: 'root is required' })`, then `const root = body.root` immediately after.
- The downstream scan/classify/persist block (`routes.ts:135-164`) is unchanged.

### Server (`server/src/__tests__/clone-workspace.test.ts`)

- Delete the entire file. Every test in it (six `it` blocks under `describe('POST /api/projects with remoteUrl', ...)`) covers a code path that no longer exists. Two tests in particular (the `root` and `remoteUrl` mutual-exclusion test, and the "neither provided" test) overlap conceptually with what `POST /api/projects` should still reject — but the surviving 400 check ("root is required") is trivial and is covered well enough by the folder-path test that already exists (verify in §Tasks 5.1).

### Tests — folder path (no change expected)

- Confirm by grep that no other test file references `remoteUrl` or invokes the now-deleted code path. Verified in tasks.md §5.1.

### No live-spec delta

The live `openspec/specs/workspace-registry/spec.md` describes `POST /api/projects` with `{ root: string }` only — it never mentioned `remoteUrl`. The live `openspec/specs/web-ui/spec.md` Import section similarly only describes the folder card. The `remoteUrl` body shape and the Clone-from-Git-URL UI card were added in the change proposals `workspaces-overhaul/specs/workspace-registry/spec.md:65, 91, 98, 106` and `unify-project-concept/specs/web-ui/spec.md:112, 124` and `unify-project-concept/specs/workspace-registry/spec.md:53, 74` — but those changes have NOT yet been archived into the live specs. So this change has no live requirement to **REMOVE**. The change directory therefore has no `specs/` subdirectory — by design, not by omission. Same posture as `remove-kickoff-recent-runs`.

### Coordination with in-flight changes

The two unarchived change proposals (`openspec/changes/workspaces-overhaul/`, `openspec/changes/unify-project-concept/`) reference `remoteUrl` in their spec deltas. If either is archived after this change merges, the archiver MUST edit out the `remoteUrl` mentions before promoting the delta to live spec, or this removal will be silently re-introduced as a requirement. The archive task list for each of those changes SHOULD be updated to call this out. This is documented here so the conflict is discoverable from `git log`, not buried in tribal memory.

Whether to proactively edit those two change directories now (vs leaving them to the future archiver) is a judgement call:

- Proactive: clean, no future foot-gun, but mixes scope (this change is "remove the clone path"; editing in-flight specs is "edit other proposals").
- Reactive: keeps scope tight, but relies on the next archiver reading this proposal. Mitigated by an explicit note (see tasks.md §6).

The recommended choice is **reactive** — keep this change scoped to the removal and add a one-line warning to each in-flight change directory's proposal so the conflict surfaces at archive time. See tasks.md §6.

## Out of scope

- A configurable destination directory, auth (SSH / PAT / `gh auth`), or WebSocket-streamed clone progress. These are the changes that would have rescued the feature on the "integrate properly" path; this proposal declines that path. If a future change re-introduces clone-in-app, it does so on a clean baseline and decides those questions explicitly rather than inheriting them.
- The PLAT-26647 branch. That branch is superseded by this change. Once this change lands, the PLAT-26647 branch can be closed without merge. (The test work from that branch is recreated by §UI `ImportView.test.tsx` above, so nothing is lost.)
- Any cleanup of `~/dev` directories created by previous clones. Those folders are real working trees and belong to the user; the change does not touch the filesystem outside the source tree.
- Renaming or re-shaping `CreateProjectRequest` beyond the field deletion. `mark?: string` is preserved (unrelated convenience for the folder path). `root` becomes required, which is the only behavioural narrowing.
- Touching the directory-browser modal (`AttachRepoModal`). The folder card uses it and continues to use it untouched.
