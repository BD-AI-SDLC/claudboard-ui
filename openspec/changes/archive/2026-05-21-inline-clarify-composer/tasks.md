## 1. UI: build the inline ClarifyComposer

- [x] 1.1 Create `ui/src/components/ClarifyComposer/ClarifyComposer.tsx`. Props: `{ runId: string, gateId: string, questions: string[], onResolved?: () => void }`. State: `answers: string[]` (one entry per question, initialized to empty strings), `resolving: boolean`.
- [x] 1.2 Render layout: when `questions.length === 1` and the question is ≤80 chars, render a single-line `<input>` with the question text as a label/placeholder above. Otherwise render N labeled `<textarea>`s stacked vertically.
- [x] 1.3 Submit handler: `api.resolveGate(runId, gateId, { answers })`. Empty strings allowed. Disable Submit while `resolving` is true.
- [x] 1.4 Skip handler: `api.resolveGate(runId, gateId, { skipped: true })`. Same disable rule. Skip button is always enabled while not resolving.
- [x] 1.5 Keyboard: for single-input layout, Enter submits and Shift-Enter inserts a newline; for multi-input layout, Cmd/Ctrl-Enter submits from any field and Tab moves between fields. Test both paths.
- [x] 1.6 Create `ui/src/components/ClarifyComposer/ClarifyComposer.css`. Pinned-bottom sticky region styled consistently with other composer-style affordances on the page. Tokens reused from `ReviewGate.css` and the active run color tokens.
- [x] 1.7 Add `ui/src/components/ClarifyComposer/ClarifyComposer.test.tsx`: render with 1 short question → assert single-line input renders; type, press Enter → assert `api.resolveGate` called with `{ answers: ['<typed>'] }`. Render with 3 questions → assert 3 textareas; fill two, Cmd-Enter → assert call with `{ answers: ['a','b',''] }`. Click Skip → assert call with `{ skipped: true }`. Re-click Submit while resolving → assert second call is not made.

## 2. UI: mount the composer on Active Run

- [x] 2.1 In `ui/src/components/ActiveRun/ActiveRun.tsx`, detect when `run.openGate?.kind === 'clarify'`. Source the gate's `payload.questions` from the run state (it is already populated by the gate-request WS event per `add-clarification-gate` task 2.3).
- [x] 2.2 Mount `<ClarifyComposer runId={runId} gateId={openGate.gateId} questions={openGate.payload.questions} onResolved={…}>` pinned below the live stream area. Confirm it does not overlap or push the stream's auto-scroll behavior.
- [ ] 2.3 When the `gate-resolved` WS event arrives, the run's `openGate` clears via existing state handling — the composer unmounts naturally. Verify this in a manual test (no code change expected).

## 3. UI: route /gate/:gateId redirects clarify gates to Active Run

- [x] 3.1 In `ui/src/App.tsx`, the existing gate route logic mounts `<ReviewGate>` or `<ClarifyGate>` based on `gateKind`. Replace the `kind === 'clarify'` branch with a redirect to `/runs/:runId` (or equivalent state mutation in the existing hash-route system) for the run that owns the gate.
- [x] 3.2 Delete the `ClarifyGate` import and the now-dead state plumbing for `clarify`-kind gates. The `gateKind` state in App.tsx may still be needed for `spec+plan` distinguishing; preserve.

## 4. UI: sidebar opens Active Run, not a gate page, for clarify gates

- [x] 4.1 In `ui/src/components/primitives/Sidebar.tsx`, the gate-nav callback for a run whose `openGate.kind === 'clarify'` SHALL invoke the run-open callback (whatever route opens Active Run) rather than the gate-open callback. Spec+plan gates still open the gate route.
- [ ] 4.2 Test (manual): open a run that already has an open clarify gate; click its entry in the sidebar; confirm Active Run opens and the composer is already visible at the bottom.

## 5. UI: RunBanner copy/behavior for clarify gates

- [x] 5.1 In `ui/src/components/RunBanner/RunBanner.tsx`, when `gateKind === 'clarify'` render a one-line "Awaiting your input below" pointer. The pointer is clickable; clicking it scrolls the page to the ClarifyComposer (`element.scrollIntoView({ behavior: 'smooth', block: 'end' })`). No Review button.
- [x] 5.2 When `gateKind === 'spec+plan'` (or unknown) the banner renders unchanged.
- [x] 5.3 Update the unit test (if present) to cover both branches.

## 6. UI: delete ClarifyGate page

- [x] 6.1 Delete `ui/src/components/ClarifyGate/ClarifyGate.tsx`, `.css`, `.test.tsx`.
- [x] 6.2 Remove any imports of `ClarifyGate` from `App.tsx` and from `index.ts` barrels if applicable.
- [x] 6.3 Search for `ClarifyGate` remaining references: `grep -r "ClarifyGate" ui/src` — must return zero hits after this task.

## 7. Skill template: generalize human-input guidance

- [x] 7.1 Edit `/Users/LUP1BG/Documents/claude-repo-scan/skills/claudboard-workflow/references/feature-workflow.template/SKILL.md.template`. Add a new top-level "Human input" subsection (right after the orchestration overview) that states: the ONLY mechanism for the orchestrator to ask the user something mid-run is `mcp__bosch__clarify_request({ questions: [...] })`. SKILL prose MUST NOT instruct the orchestrator to print a question and wait for the next user turn — that pattern silently terminates headless runs.
- [x] 7.2 In the same subsection, document the sub-agent relay pattern: a sub-agent that needs user input mid-execution returns `{ needsInput: { questions: string[], reason: string } }` in its JSON result block. The orchestrator detects this, calls `clarify_request`, then re-spawns the sub-agent with the answers appended to its INPUT CONTEXT (e.g. as a new `userAnswers` field). Note explicitly that sub-agents do NOT call `clarify_request` themselves.
- [x] 7.3 In Phase 1a (Clarify scope), keep the existing `clarify_request` loop description but cross-reference the new general guidance section. Remove any phrasing that implies `clarify_request` is exclusive to Phase 1a.

## 8. Skill template: wire clarify_request at every human-input site

- [x] 8.1 Phase 1a-ws (Affected repos inference and confirmation). The current template at this section (lines ~590-604 in the generated form) presents the affected-repos list and ends with "Confirm or adjust? [confirm / add <repo> / remove <repo>]" as prose. Replace with: build the question string from the inferred list and call `mcp__bosch__clarify_request({ questions: ["<rendered list + instructions>"] })`. Parse `result.answers[0]`:
  - `"confirm"` (case-insensitive) → hold list, proceed to 1b.
  - starts with `"add "` → parse repo name, add to `affectedRepos`, re-spawn architect with the adjusted list, loop.
  - starts with `"remove "` → parse repo name, remove from `affectedRepos`, re-spawn architect, loop.
  - `{"skipped": true}` → proceed with the inferred list as-is (treat as confirm).
- [x] 8.2 Phase 3 (Develop and test) — implementation-agent blocker. Where the template currently says "Present the blocker description to the user and wait for guidance," replace with: build a question describing the blocker and call `clarify_request({ questions: ["<blocker description>\n\nHow should I proceed? (retry / skip / abort / <custom>)"] })`. Parse the answer and act:
  - `"retry"` → re-spawn the implementation-agent on the same checkpoint.
  - `"skip"` → mark the checkpoint blocked, move to the next.
  - `"abort"` → halt the workflow (non-recoverable failure path).
  - any other text → treat as custom guidance, pass to implementation-agent in a follow-up spawn.
- [x] 8.3 Phase 5a (Spec review). Where the template currently says "If still failing after one fix cycle, present the remaining findings to the user and ask for guidance," replace with a `clarify_request` call that includes the remaining findings and asks the user how to proceed (retry / accept-as-is / abort / custom). Same parsing pattern as 8.2.
- [x] 8.4 Phase 5b (Design review). Same pattern as 8.3.
- [x] 8.5 Update the "Quick reference" table at the bottom of the template so the "Gate" column for each affected phase reflects the new `clarify_request` usage.

## 9. Regenerate the local meas skill

- [x] 9.1 In `/Users/LUP1BG/Documents/BoschProjects/meas/`, run `/claudboard-workflow` (or the documented regenerate command) to re-render the SKILL from the updated template.
- [x] 9.2 Verify the generated `/Users/LUP1BG/Documents/BoschProjects/meas/.claude/skills/feature-workflow/SKILL.md` contains:
  - the new Human input subsection (`grep -c "mcp__bosch__clarify_request" SKILL.md` returns ≥5).
  - the Phase 1a-ws section no longer ends with raw "Confirm or adjust?" prose.
  - the Phase 3/5 blocker/escalation prose has been replaced.
- [ ] 9.3 Commit the regenerated skill in the meas workspace (separate from this repo).

## 10. Manual end-to-end verification

- [ ] 10.1 Start a fresh feature run against `/Users/LUP1BG/Documents/BoschProjects/meas/` with a prompt that requires affected-repos confirmation (multi-repo workspace). Confirm: (a) Phase 1a-ws actually pauses the run, (b) the Active Run page shows the inline composer with the question rendered, (c) typing `confirm` and pressing Enter resolves the gate and the run proceeds to 1b.
- [ ] 10.2 Repeat 10.1 but type `add <some-repo>` instead — confirm the architect-agent is re-spawned with the adjusted list and a fresh composer appears with the updated question.
- [ ] 10.3 Trigger a Phase 1a clarification run with an under-specified prompt. Confirm the composer renders as stacked textareas (multi-question), Cmd-Enter submits all answers, and the orchestrator proceeds.
- [ ] 10.4 (Best-effort) Force an implementation-agent blocker by simulating a failing baseline. Confirm the composer renders, the user can type a response, and the workflow acts on it.
- [ ] 10.5 Confirm that `kind === 'spec+plan'` gates STILL open `ReviewGate` as a separate page (no regression).
- [ ] 10.6 Confirm that clicking a run with an open clarify gate in the sidebar opens Active Run (not a separate gate page) and the composer is already visible.

## 11. Validation

- [x] 11.1 `npm run build -w protocol -w server -w ui` — all workspaces compile after the UI deletions/additions.
- [x] 11.2 `npm test -w ui` — new ClarifyComposer tests pass; deleted ClarifyGate tests are gone; existing tests are not broken.
- [x] 11.3 `openspec validate inline-clarify-composer --strict` — proposal, tasks, and spec deltas parse cleanly.
