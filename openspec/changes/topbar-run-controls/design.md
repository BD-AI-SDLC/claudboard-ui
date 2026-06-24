## Context

The Active Run page is the screen a user stares at for the duration of a long agent run. Today it offers one working interactive control during the run — Pause/Resume — and zero affordances for the other two verbs that come up naturally: "give up on this attempt" (Stop) and "try again with these parameters" (Restart).

The `ui/designs/Active Run V2.html` design promotes the run controls into a topbar cluster, freeing the Stream pane header of action chrome and creating one obvious destination for "what do I do with this run." This change adopts that cluster, narrows V2's ambiguous "Stop" red square to "kill irrecoverably," and adds Restart as a UI-only navigation primitive (the Kickoff page already accepts the parameters Restart needs).

The relevant SDK primitive is `Options.abortController` (`@anthropic-ai/claude-agent-sdk`, `sdk.d.ts:1163`) — cancelling the controller stops the query, tears down the in-process MCP server, and propagates an iterator exception to our `for-await` loop. That same primitive was the foundation of the now-superseded `add-run-suspend` proposal (its Design D2). This change keeps the controller plumbing and discards everything else suspend was building on top of it (session capture, cold-resume, MCP idempotency).

Restart is the cheapest of the three verbs because the Kickoff form already exists, the parameters it needs (`prompt`, `target`, `autonomy`) are already on the `Run` protocol type, and `GET /api/runs/:id` already returns them. Restart is therefore pure client-side navigation with a query-param handoff.

## Goals / Non-Goals

**Goals:**
- The topbar of the Active Run page is the single destination for run controls. Pause/Resume, Stop, and Restart live there, visually grouped (Pause/Resume + Stop) and separated (Restart) per their semantics.
- Clicking Stop on a live run aborts the SDK, transitions the run to a new terminal status `'cancelled'`, resolves any open gate cleanly, and survives server restart.
- Clicking Restart at any time navigates to the Kickoff page pre-populated with the source run's prompt/target/autonomy. Restart never mutates the source run (except via the explicit "Stop and restart" branch of its confirmation popover for live runs).
- Stop's destructive intent is gated by an anchored confirmation popover. The popover primitive becomes the codebase's pattern for every future destructive action.
- Prereq runs are excluded from the cluster entirely — the verbs do not apply to a short CLI-launched prereq.
- Suspend (the `add-run-suspend` proposal) is superseded; the AbortController primitive carries over, the rest is dropped.

**Non-Goals:**
- Stop on a prereq run. Killing a hung prereq still requires killing the server. A future change MAY add `subprocess.kill` to the prereq CLI runner if demand warrants.
- Suspend-style cold resume from disk. The SDK session-id capture, the `resume: sessionId` code path, the MCP gate idempotency, the `'suspended'` status — all dropped.
- Reverting uncommitted workspace edits on Stop. The user owns their git state; this change does not reach into the working tree.
- Carrying forward the cancelled run's branch / commit / artifacts into the restarted run. Restart is "new run with these kickoff parameters," not "resume this exact attempt."
- Keyboard shortcuts for Stop / Restart. No global key-handler infrastructure exists.
- Toast / global notification surface. Inline error styling and the new popover primitive are sufficient.

## Decisions

### D1. Order of operations in `stopRun`: update row BEFORE aborting controller

**Choice:** `stopRun` writes `UPDATE runs SET status='cancelled' WHERE id=?` and updates open gate rows BEFORE calling `controller.abort()`. The catch-discrimination logic in `runFeature` reads the persisted `runs.status` to decide whether an abort is a cancel (silent) or a failure (failed-status path).

**Why:** Doing it the other way round produces a brief window where the for-await loop's outer catch fires with `signal.aborted === true` but the row is still `'running'`. The catch then can't tell whether the abort is a user-initiated stop or a bug, and risks classifying the cancel as a failure. Updating the row first eliminates the race.

**Equivalent to `add-run-suspend`'s Design D2:** same pattern, same justification, different terminal status (`'cancelled'` here vs. `'suspended'` there).

### D2. `runControllers` is module-level state, not a class

**Choice:** Add `const runControllers = new Map<string, AbortController>()` at module scope in `driver.ts`, mirroring the existing `pauseRequested` and `pauseDeferreds` maps.

**Why:** Consistency with the existing two maps in the same file. A driver-as-class refactor is a separate concern that would unrelatedly enlarge the diff; doing it here would push this change beyond its scope. If the driver later becomes a class, all three maps move in together.

**Lifecycle:** the controller is registered before `query()` is called and deleted in a `try/finally` so it cannot leak on completion, failure, or stop. `stopRun` also calls `delete` defensively after `.abort()`.

### D3. New `'cancelled'` status, NOT reusing `'dead'`

**Choice:** Add a new `RunStatus` value `'cancelled'`. Existing `'dead'` is reserved for "we found this run in a non-terminal status at boot, so we declared it dead" (the crash-recovery path in `sweep.ts`).

**Why:** Conflating the two muddies the data. A user querying "how many runs did I deliberately stop this week?" is a different question from "how many runs survived a server crash?". The cost of a new status is small (one switch arm + one StatusChip variant + a few `if (status === 'cancelled')` checks where exhaustive-switching kicks them in).

**Color in StatusChip:** slate / muted-grey, not red. `'dead'` is presumably red (the run died unexpectedly). `'cancelled'` is intentional — the user chose this — and reading red on a self-chosen action implies the system thinks the user did something wrong. Slate reads as "intentional ending."

### D4. `'cancelled'` is terminal and survives server boot

**Choice:** `'cancelled'` joins `'done'` and `'failed'` as terminal — the boot sweep at `sweep.ts` does NOT include it in `non_terminal`. A `'cancelled'` row at boot stays `'cancelled'`.

**Why:** It's terminal by construction. The SDK conversation is gone; there is nothing to recover. Adding it to the non-terminal sweep list would transition it to `'dead'` on boot, which is wrong (the run did not die — it was stopped).

### D5. Hide the run-control cluster entirely for `kind='prereq'` runs

**Choice:** `RunControlCluster` reads `run.kind`. If `'prereq'`, it returns `null` — no buttons, no slot, nothing rendered.

**Why:** All three verbs in the cluster are feature-run concepts.
- Pause/Resume already does not work on prereqs (they use `prereq/cli-runner.ts`, not the SDK).
- Stop would need a separate `subprocess.kill` code path (out of scope for this change — see Non-Goals).
- Restart on a prereq does not have a meaningful "tweak the prompt and re-run" flow because prereq prompts are fixed by the prereq kind.

Hiding the cluster is the most honest treatment — the prereq run page simply doesn't have these affordances, rather than showing a cluster of disabled buttons that mislead.

The server-side `/stop` endpoint also rejects `kind='prereq'` with 409 + explanation, so a programmatic caller gets the same answer.

### D6. Anchored Popover primitive is the destructive-action convention

**Choice:** Introduce a new `Popover` primitive — small (~80-120 LOC), anchored to a trigger element, dismissable via click-outside / ESC / Cancel button, with proper ARIA roles and focus trap. Stop and Restart-while-active both use it.

**Why over a modal:** Modals are heavier infrastructure and visually heavier. The decision space here (Cancel vs. Confirm — or Stop and restart / Start alongside / Cancel) is small enough that a popover scales. Anchoring to the trigger creates a strong cause-and-effect signal — the question is visually attached to the button the user just clicked.

**Why over inline two-step ("click again to confirm"):** Restart-while-active has three meaningful answers, not two. The inline pattern can't carry that without inventing a new shape; the popover handles both two-button and three-button cases uniformly.

**Why over no confirm at all:** Stop is irrecoverable for the current run's agent state. Restart-while-active leaves a parallel run burning tokens if the user didn't mean to keep the live one running. The friction of one extra click is the right cost for both.

**Lasting artifact:** the next destructive action in the codebase — delete an attached repo, abort a gate, anything similar — should use this same `Popover`. The convention is set here.

### D7. Restart prefill uses `?prefill=<runId>` + existing `GET /api/runs/:id`

**Choice:** Clicking Restart navigates to `/kickoff?prefill=<runId>`. The Kickoff component, on mount, reads the query param; if present, calls `api.getRun(prefillId)`, populates form state from `run.prompt`, `run.target`, `run.autonomy`. The query param is then cleared via `window.history.replaceState` so a subsequent refresh of the Kickoff page does not re-prefill.

**Why not router state push:** state lost on hard refresh. The query-param flow survives.

**Why not sessionStorage:** not refresh-safe, does not work across tabs, and the implicit data flow is harder to debug.

**Why no new endpoint:** `Run.prompt`, `Run.target`, `Run.autonomy` are already exposed by the protocol type and returned by `GET /api/runs/:id`. Adding a dedicated `/kickoff-params` endpoint would duplicate them.

**Why clear the query param on mount:** the prefill should fire exactly once per navigation. Without `replaceState`, a refresh of `/kickoff?prefill=X` would re-fetch and re-populate, surprising a user who had started editing the form.

### D8. Stop does not touch the workspace or git state

**Choice:** `stopRun` aborts the SDK and updates the DB. It does NOT `git reset`, `git stash`, delete files, undo the branch, or otherwise touch the working tree.

**Why:** The user owns their git state. If the agent half-implemented a feature and the user hits Stop, the user's next action might be `git diff` to inspect what was started, or `git stash` to keep it, or `git checkout .` to discard. Automating any of those takes the choice away.

**The Stop confirmation copy says so:** "In-flight work will be lost. The transcript and workspace files are preserved." This is honest — the SDK conversation is gone, but the files on disk are whatever they were the moment Stop fired.

### D9. The `add-run-suspend` change is superseded, not bundled

**Choice:** This change does NOT implement the in-flight `add-run-suspend` proposal. That proposal's design notes — particularly the AbortController map (its D2) and the abort-vs-failure outer-catch discrimination — carry over verbatim, with `'cancelled'` substituted for `'suspended'`. The session-capture work, the cold-resume code path, the MCP gate idempotency, the `'suspended'` status, the sidebar Parked section — all dropped.

**Why:** The product question both changes try to answer ("what does a user need when they want to step away from a run?") admits two answers — preserve agent state for later (suspend) or give up and start fresh (stop+restart). We chose the latter as the primary affordance because:
1. The common case is a failed attempt, not a tactical step-away.
2. Stop+restart uses primitives that already exist; suspend introduces protocol, schema, driver, and MCP-gate work.
3. Restart with prefill makes "I want to try a slightly different prompt" a 2-click flow instead of a re-type.

**Archival plan:** the user has a saved branching rule that each OpenSpec change gets its own branch. The `add-run-suspend` archival is therefore a separate change (one-line edit to mark superseded, or a folder move under `openspec/changes/archive/`). Not bundled with this one.

## Risks / Trade-offs

- **Risk:** The Popover primitive is the first of its kind. If we get the focus-trap or ESC handling wrong, every future destructive action inherits the bug. **Mitigation:** Lean on the test suite — `Popover.test.tsx` covers anchor positioning, click-outside, ESC, focus return-on-close, and ARIA roles. Manual a11y check during implementation.

- **Risk:** Removing Pause/Resume from the Stream pane head disturbs muscle memory for early users who learned to click there. **Mitigation:** None planned; the relocation is the point of the change. The topbar position is more discoverable for new users (Active Run V2 was designed around this). Communicate in the release note.

- **Risk:** A user clicks Restart on a live run, picks "Start alongside," and forgets the original is still running and burning tokens. **Mitigation:** The "Start alongside" copy in the popover explicitly says "This run will keep running." The sidebar's active-runs list also shows both runs side-by-side. We do not auto-stop — that would defeat the "Start alongside" choice.

- **Risk:** `'cancelled'` is added to `RunStatus` but some consumer's exhaustive switch is missing a case. **Mitigation:** TypeScript catches this at compile time. Run `npm run typecheck` from root; any `RunStatus` switch without exhaustive handling surfaces immediately.

- **Risk:** The `/stop` endpoint races with a `/pause`, `/resume`, or another `/stop` on the same run. **Mitigation:** Status-precondition checks in the route handler (409 on mismatch). Worst case is one request wins, others 409 — recoverable.

- **Risk:** The Restart navigation fires before the source run's `GET /api/runs/:id` response, leaving Kickoff briefly empty. **Mitigation:** Show a loading state in Kickoff when `?prefill=` is present and the fetch is in flight. Auto-clear on response.

- **Trade-off:** Module-level mutable `Map` in `driver.ts` (same as the existing two maps) makes the driver harder to test in isolation. **Justification:** Consistency with the existing pattern. Driver-as-class is a separate refactor.

- **Trade-off:** Restart-as-navigation (not as a server-side verb) means we cannot easily track "this run is a restart of that run" in the DB. **Justification:** Out of scope. A future "run lineage" feature can add a `parent_run_id` column without contradicting this design.

## Migration Plan

1. Ship the protocol change first (`'cancelled'` status, `'run-cancelled'` event). Both server and UI rebuild against it; existing consumers gain an exhaustive-switch type error wherever they switch on `RunStatus`, which surfaces at compile time and is the right place to handle the new case.
2. Deploy server with new `runControllers` map, `stopRun`, `/stop` endpoint, sweep comment. The new code path is dormant until a client calls `/stop`.
3. Deploy UI with the new `Popover` primitive, `RunControlCluster`, topbar mount in `ActiveRun.tsx`, pane-head pause-button removal, Kickoff prefill, StatusChip `'cancelled'` variant. The Pause/Resume button visibly moves from pane head to topbar; users will notice on next page load.
4. Existing runs in any status at deploy time are unaffected. The new `runControllers` map is empty at boot; the first new run after deploy registers its controller normally. Existing `paused-user`, `paused-gate`, or `running` rows at boot are handled by the existing sweep — unchanged.
5. The `add-run-suspend` change is archived as superseded in a separate one-line change (or folder move under `openspec/changes/archive/`). Per the user's saved branching rule, this is a distinct branch.

## Open Questions

None remaining. All resolved in the explore-mode session that produced this change:
- Stop = Suspend, Cancel, both, or replace? — **Replace.** Stop+Restart instead of Suspend. (Design D9.)
- Restart model? — **Pre-fill Kickoff and let user tweak.** (Design D7.)
- When is Restart available? — **Always.** Confirmation popover gates the destructive case (Design D6).
- Confirm pattern? — **Anchored Popover.** New primitive, becomes the codebase convention. (Design D6.)
- Prereq runs? — **Hide the cluster entirely.** (Design D5.)
- Prefill mechanism? — **Query param + existing GET.** (Design D7.)
- New status vs reuse `'dead'`? — **New `'cancelled'`.** (Design D3.)
- Order of update vs abort in `stopRun`? — **Update first, then abort.** (Design D1.)

Implementation-time questions (to resolve during apply, not now):
- Exact StatusChip token for `'cancelled'` — slate, muted, or a sibling of an existing chip variant. Pick during implementation by mirroring the file's existing variant pattern.
- Whether `RunControlCluster` inlines the Pause/Resume button or composes the existing `PauseResumeButton.tsx` child. Inlining is cleaner if the cluster's layout differs significantly from a row of three independent buttons; composing avoids rewriting tested code. Default to composing unless it reads poorly.
- Whether the Popover primitive lives at `components/primitives/Popover.tsx` or under a new `components/primitives/overlay/` subdirectory. Default to flat `primitives/` to match the existing layout; revisit if more overlay primitives appear.
- Whether the Kickoff prefill should fire automatically on mount or wait for the user to confirm "use this as a starting point." Default to fire-on-mount per Design D7; revisit if it surprises users in QA.
