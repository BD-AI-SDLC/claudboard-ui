## Context

The Clone-from-Git-URL path was shipped end-to-end by `workspaces-overhaul` and renamed through `unify-project-concept`. It is described as the second of two attach options ("Open local folder" and "Clone from Git URL"), reachable from the workspace dropdown's `+ Add project` row → full-page `ImportView`. The implementation choices were intentionally minimal in v1 (no auth, no progress, hardcoded destination, 60s timeout) on the assumption that v1 would prove the concept and a follow-up change would invest in the real shape.

That follow-up never happened. Instead, a partial removal landed on a feature branch (`feature/PLAT-26647/remove-clone-git-url`, commit `5f101a6`) — UI surface gone, server and protocol untouched. The exploration in this change established two findings:

1. The reason the rescue investment never came is structural: the no-auth limitation excludes the actual target audience (Bosch internal repos behind auth). The feature would have to be designed for credentials before it could be useful, and that design is open enough to be its own multi-change effort.
2. The reason the partial removal didn't land is scope: PLAT-26647 was framed as an FE cleanup and left a UI-less endpoint + a `remoteUrl` protocol field + a six-test file behind, all of which would have read as "dead code" to the next reader.

This change merges those two findings into one coherent removal that spans UI, protocol, and server, supersedes PLAT-26647, and resets the surface to "attach by folder only."

## Goals / Non-Goals

**Goals:**

- The "Add project" flow SHALL offer exactly one path: Open local folder. The clone card, the clone form, the clone state, and the clone handler SHALL be gone from the UI.
- The protocol type `CreateProjectRequest` SHALL no longer mention `remoteUrl`. `root` SHALL be required.
- The server endpoint `POST /api/projects` SHALL accept `{ root: string; mark?: string }` only. The `cloneRepo` helper, the `git clone` shell-out, and the `clone-workspace.test.ts` suite SHALL be removed.
- The change SHALL be reversible by a single revert commit per area (one UI commit, one protocol commit, one server commit — or one combined commit at the author's discretion; the per-change branching rule applies).
- The folder-attach path SHALL be untouched and SHALL continue to pass its existing tests with no modification.
- The change SHALL leave the two in-flight change proposals (`workspaces-overhaul`, `unify-project-concept`) with discoverable warning notes so a future archiver does not silently re-introduce `remoteUrl` into the live spec.

**Non-Goals:**

- Rescuing the clone path by adding auth, progress streaming, configurable destination, or extended timeout. That is the path this proposal explicitly rejects.
- Editing the live `web-ui` or `workspace-registry` specs. They never mentioned `remoteUrl`; there is nothing to REMOVE.
- Editing the spec deltas inside `workspaces-overhaul` or `unify-project-concept` to strip `remoteUrl`. The minimal warning approach (a note appended to each proposal's "Coordination" section) is preferred for scope reasons — see D6.
- Cleaning up `~/dev/<repo-name>` directories created by prior clones. Those are the user's working trees.
- Renaming or restructuring `CreateProjectRequest` beyond the field deletion. The convenience field `mark?: string` stays.
- Rewriting `AttachRepoModal` or any part of the folder browser. Untouched.

## Decisions

### D1: Remove the entire stack, not just the UI

The PLAT-26647 branch demonstrated what UI-only removal looks like: the card disappears, the test file `clone-workspace.test.ts` keeps running against an endpoint nobody calls, and a `remoteUrl` field stays on a public protocol type with no documented user. The next reader has to reconstruct whether the omission is deliberate or accidental. The cost of doing the wider removal in the same change is small (one server file, one protocol field, one test deletion) and the cost of NOT doing it is a future archaeology session for whoever next touches `registry/routes.ts` and wonders why `cloneRepo` exists. Decision: remove the full stack. PLAT-26647 is superseded.

### D2: `root` becomes required, `mark` stays optional

After `remoteUrl` is removed, `CreateProjectRequest` has only `root` and `mark`. `root` is the entry point and has no default; making it required reflects the actual constraint. `mark` is a presentation override (the two-letter chip in the project switcher) that the server already falls back on via `deriveMark` (`registry/routes.ts:49-53`) when absent. Leaving `mark` optional preserves backwards compatibility for any client that does want to override and matches the existing UI behaviour (the folder card does not pass `mark`).

### D3: No live-spec delta

The live `openspec/specs/web-ui/spec.md` Import section and `openspec/specs/workspace-registry/spec.md` API section both describe `POST /api/projects` (originally `POST /api/workspaces`) with `{ root }` only. The `remoteUrl` shape was added in two unarchived change proposals (`workspaces-overhaul`, `unify-project-concept`). There is therefore no live requirement to REMOVE — adding a spec delta would mean inventing a prior requirement so this change can repeal it. The correct posture is no `specs/` subdirectory in this change. This mirrors the decision made in `remove-kickoff-recent-runs/design.md` D2.

### D4: One smoke test, not a regression suite

Following the same precedent as `remove-kickoff-recent-runs` D5: the only test that earns its maintenance cost is the one that fails loudly if the clone surface is re-introduced. A handful of negative assertions in `ImportView.test.tsx` (no clone card, no Repository URL label, no GitHub-placeholder input, no `/clone/i` in the add-mode subtitle) + one positive assertion that the folder card still transitions correctly is sufficient. The PLAT-26647 branch had 9 assertions; this change consolidates to a smaller, sharper set with the same forward-protection. No analogous server-side test needs to exist — once `clone-workspace.test.ts` is deleted and the server handler narrows, the deleted code path cannot be re-introduced without also deleting tests, which is a much larger and more obvious diff.

### D5: Delete `clone-workspace.test.ts` rather than rewrite

Six tests in `clone-workspace.test.ts` cover the now-removed branch. Two of them (the `root` + `remoteUrl` mutual-exclusion test and the "neither provided" test) overlap with what the surviving 400 guard should reject. The simplest move is to delete the file outright. The surviving 400 path ("root is required") is trivial single-line logic and is implicitly exercised every time the folder card hits the endpoint successfully — if `root` were rejected on a valid payload the folder path would break in CI immediately. Adding a dedicated test for "missing root returns 400" against the new shape is optional; it costs a few lines and adds defence-in-depth, so the task list includes it as a small `200/400` pair check in a renamed test file (`projects-create.test.ts`) — see tasks.md §4. The decision here is just "don't try to salvage `clone-workspace.test.ts` — delete and replace if needed."

### D6: Warn the in-flight proposals, don't edit them

The two unarchived change proposals (`workspaces-overhaul`, `unify-project-concept`) include spec deltas that mention `remoteUrl`. If either is archived after this change merges and the archiver promotes the delta verbatim, `remoteUrl` re-appears in the live spec as a requirement — silently overriding the removal. There are three ways to prevent that:

1. **Edit the in-flight deltas now** to strip `remoteUrl` mentions. Wide scope creep — this change becomes "remove clone path + retroactively edit two other proposals."
2. **Append a warning note** to each in-flight change's `proposal.md` ("when archiving this change, omit the `remoteUrl` mentions — they were removed by `remove-clone-from-git-url`"). Narrow, discoverable from `git log`, no code in those proposals changes.
3. **Trust the archiver.** Smallest scope, highest risk.

This change picks option 2. The note is added by tasks.md §6.1 and §6.2 as one-line appendices to those proposals' `proposal.md` files — under a clearly-titled section so it's discoverable without reading the whole file. The cost is two trivial edits in unrelated change directories; the benefit is that re-introduction can't happen accidentally.

### D7: Reword the add-mode subtitle, don't delete it

`ImportView.tsx:88-91` renders one of two subtitles depending on `isAddMode`:

```
isAddMode
  ? 'Open a local folder or clone a git repo to add another project.'
  : 'Point claudboard at a project to start tracking feature runs.'
```

The non-add-mode subtitle is unrelated to the clone path. The add-mode subtitle explicitly mentions cloning. Two options: delete the conditional and unify on the non-add-mode copy, or reword the add-mode branch. The conditional carries semantic meaning beyond cloning ("add another" vs first-run framing) and should be preserved; only the wording changes. Replacement copy: `"Open a local folder to add another project."`. Five-word delta, intent preserved.

### D8: Test file recreated, not cherry-picked

The PLAT-26647 branch already has an `ImportView.test.tsx` with 9 assertions. Cherry-picking that file would inherit a test-suite shape designed for a UI-only removal, and would also create a misleading git history (the test would land in a commit that is otherwise about a wider removal). This change writes the test file from scratch with the smaller, sharper assertion set described in D4. The PLAT-26647 author's work is not lost — the assertions are equivalent in intent — and the test file's provenance matches the change that introduces the behaviour it tests.

## Risks / Trade-offs

- **A user actually relies on clone-in-app.** Theoretical, given the no-auth limitation. Mitigation: the workflow loses one click, not a capability — the user can `git clone` in the same terminal session and then attach via "Open local folder." If real complaints surface, that is evidence to invest in the rescue path properly (auth, progress, configurable destination) rather than restore the v1 stub.
- **The PLAT-26647 author reads this as a teardown.** Mitigation: the proposal frames PLAT-26647 as the partial first move and this change as the completion. The author's RTL assertion work is preserved in D8's recreated test file. Credit can be attached explicitly in the PR description.
- **Future archiver of `workspaces-overhaul` or `unify-project-concept` ignores the warning note.** Mitigation: the note appears in `proposal.md` (the file the archiver definitely reads) under a clearly-titled section. If they still miss it, the change will visibly contradict the live code path — the build would not fail, but the next attempt to use the live spec as a source of truth would surface the discrepancy.
- **The narrowed `root: string` (no longer optional) is a breaking protocol change for any third-party caller.** The protocol package is `@bosch-sdlc/protocol` and is consumed only by `server` and `ui` in this repo (confirmed by inspection of `protocol/package.json`'s `dependencies` field at exploration time). The risk is bounded to internal consumers.
- **An OpenSpec spec for the eventual rescue feature would need to introduce `remoteUrl` from scratch.** Acceptable — that's the cleaner shape anyway. Documented in Out of Scope.

## Open Questions

- **Should the change also archive PLAT-26647's specs subtree?** That branch's commit added `specs/001-PLAT-26647-remove-clone-git-url/` — but those specs live on the branch, not on `main`. They land or fail to land alongside that branch's lifetime. This change ignores them; the PLAT-26647 branch will be closed without merge once this change lands. If the author wishes to preserve their spec drafts they can be referenced in this change's PR description as prior art.
- **Do we want a follow-up that adds a deprecation header to `~/dev` itself?** No — the folder is the user's working tree and pre-dates this feature. Out of scope.
