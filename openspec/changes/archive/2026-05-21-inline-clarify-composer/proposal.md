## Why

The `add-clarification-gate` change (now shipped — proposal/tasks/specs under `openspec/changes/add-clarification-gate/`) introduced `mcp__bosch__clarify_request` as a way for the orchestrator to pause and ask the user questions. In practice two problems surfaced on the first manual run:

1. **The clarify UI takes the user off the live stream.** When the orchestrator calls `clarify_request`, the Active Run page shows a banner with a Review button; clicking it navigates to a dedicated `ClarifyGate` page with N textareas. That page-takeover treatment was modeled on `ReviewGate` (spec+plan approval), where the user genuinely needs a focused page to read large documents. For clarification — typically a sentence or two per question — the navigation cost is disproportionate. The user wants to read the question in the live stream context and reply *inline* without leaving the page, the way a terminal chat composer works.

2. **The mechanism is only wired into Phase 1a.** The generated SKILL only calls `clarify_request` for initial scope clarification. Every other point where the workflow needs human input — the workspace-mode Phase 1a-ws affected-repos confirmation (which currently just prints text and ends the run — see `feature-workflow/SKILL.md:590-604`), implementation-agent blocker reports (Phase 3, which "ask the user and wait" with no actual pause), spec/design-reviewer escalations after a failed fix cycle (Phase 5) — relies on the legacy "print a question and hope the user notices" pattern. That pattern silently terminates the run because the orchestrator has nothing else to do after emitting the prose.

The fix is the same primitive applied two ways: render the existing `clarify_request` payload as an inline composer pinned to the bottom of the Active Run page (no navigation), and instruct the SKILL to use `clarify_request` at every site where the orchestrator currently expects an inline reply that the headless `query()` iterator cannot deliver.

The spec+plan gate (`ReviewGate`) is intentionally left alone. Reading a multi-page spec + execution plan and choosing approve/reject *does* deserve a dedicated page; that interaction is not what this change is about.

## What Changes

- **`ClarifyGate` page is removed.** The component, its CSS, its test file, and the App-route branch that mounts it are all deleted. Navigation to `/gate/:gateId` for a `kind === 'clarify'` gate redirects to the Active Run page for that gate's run instead.
- **A new inline `ClarifyComposer` component renders on the Active Run page.** When the active run's `openGate.kind === 'clarify'`, the composer is pinned below the live stream as a sticky region. It renders the gate's `payload.questions` as N labeled inputs (a single-line `<input>` when the question is short and there's only one; stacked `<textarea>`s when there are multiple or any single question exceeds a length threshold), a Submit button, and a Skip button. On submit it POSTs `{ answers }` to the existing `/api/runs/:runId/gate/:gateId/resolve` endpoint; on skip it POSTs `{ skipped: true }`. The wire protocol is unchanged.
- **Keyboard affordance.** When the composer is single-question/single-line, pressing Enter submits and Shift-Enter inserts a newline. When the composer is multi-question, Cmd/Ctrl-Enter submits from any field; Tab moves between fields.
- **The gate banner copy and behavior diverge by kind.** For `kind === 'spec+plan'` the banner keeps its existing "Review" button that navigates to `ReviewGate` (unchanged). For `kind === 'clarify'` there is no Review button — the banner shrinks to a one-line "Awaiting your input below" pointer that scrolls the page to the composer when clicked. The composer itself is the action surface.
- **Sidebar navigation to a clarify gate routes to Active Run, not to `/gate/:gateId`.** A run with `openGate.kind === 'clarify'` in the sidebar's runs list, when clicked, opens the Active Run page for that run; the composer is already visible there. No separate gate route is opened.
- **The SKILL template gains a "human input" guidance section** describing `clarify_request` as the *only* mechanism for the orchestrator to ask the user something. The prior Phase 1a-specific instructions are kept but generalized. New explicit instructions are added at the four other current ask-the-user sites in the generated SKILL: Phase 1a-ws (affected-repos confirmation), Phase 3 implementation-agent blocker, Phase 5a spec-review escalation after one failed fix cycle, Phase 5b design-review escalation after one failed fix cycle. In each case, the prose "ask the user and wait for guidance" is replaced with an explicit `clarify_request` call.
- **A sub-agent relay pattern is documented** for the case where a sub-agent (architect, implementation, reviewer) encounters mid-execution ambiguity. The sub-agent returns `{ needsInput: { questions: string[], reason: string } }` as part of its JSON result block. The orchestrator catches that, calls `clarify_request` with the questions, then re-spawns the sub-agent with the answers appended to its INPUT CONTEXT. (We do not pursue letting sub-agents call `clarify_request` directly — that would require the SDK to suspend nested Task tool calls and resume with a result, which is not supported today.)
- **The `add-clarification-gate` task 8 (manual end-to-end verification) is reset and re-executed under the new UX.** Its checkbox state is moved into this change's tasks; the original change closes out without the manual verification ever having been "approved" in the form it originally specified.

## Capabilities

### New Capabilities

None. The change refines the rendering and broadens the usage of capabilities introduced by `add-clarification-gate`.

### Modified Capabilities

- `web-ui`: The `ClarifyGate screen captures free-form answers per question` requirement is REMOVED. A new requirement `Active Run page renders an inline ClarifyComposer when a clarify gate is open` is ADDED. The `Gate routing in App.tsx branches on gate kind` requirement is MODIFIED: `kind === 'clarify'` no longer mounts a page component — it redirects the route to Active Run. The `RunBanner copy reflects the gate kind` requirement is MODIFIED: for `kind === 'clarify'` the banner shows a scroll-to-composer pointer instead of a Review button.
- `workflow-instrumentation`: The `Generated SKILL Phase 1a uses clarify_request, not inline conversation` requirement is MODIFIED to generalize from Phase 1a to all orchestrator-level human-input sites in the SKILL. A new requirement `Generated SKILL uses clarify_request at every human-input site` is ADDED enumerating the four additional sites and the sub-agent relay pattern. The `SKILL guidance permits zero rounds when prompt is sufficient` requirement is retained as-is.

`gate-bridge` is intentionally unchanged: the MCP tool signature, gate row shape, WebSocket events, and REST resolve endpoint stay the same. This change is rendering + SKILL prose only.

## Impact

- **Code deleted.**
  - `ui/src/components/ClarifyGate/ClarifyGate.tsx` and `.css` — the page component.
  - `ui/src/components/ClarifyGate/ClarifyGate.test.tsx` — its test file.
  - The `<ClarifyGate>` mount branch in `ui/src/App.tsx`.
- **Code added.**
  - `ui/src/components/ClarifyComposer/ClarifyComposer.tsx` — the inline composer. Props: `{ runId: string, gateId: string, questions: string[], onResolved?: () => void }`. Renders single-line `<input>` for one short question, stacked `<textarea>`s otherwise. Handles Submit / Skip / keyboard shortcuts. ~140 LoC.
  - `ui/src/components/ClarifyComposer/ClarifyComposer.css` — pinned-bottom sticky region styled consistently with other composer-style affordances on the page. ~50 LoC.
  - `ui/src/components/ClarifyComposer/ClarifyComposer.test.tsx` — render with 1 question (single-line input), Enter submits; render with 3 questions (stacked textareas), Cmd-Enter submits; Skip POSTs `{ skipped: true }`; Submit disabled during in-flight request. ~120 LoC.
- **Code edited.**
  - `ui/src/components/ActiveRun/ActiveRun.tsx` — when the run's `openGate.kind === 'clarify'`, mount `<ClarifyComposer>` below the live stream. Read `openGate.gateId` and `openGate.payload.questions` from the existing run state. Wire `onResolved` to clear the local "awaiting input" flag (the WS `gate-resolved` event will already handle most state).
  - `ui/src/App.tsx` — gate route's `kind === 'clarify'` branch is removed. The route handler for `/gate/:gateId` checks the gate kind (via `api.getRun(runId)`) and, if clarify, navigates to `/runs/:runId` instead. ~15 LoC delta.
  - `ui/src/components/RunBanner/RunBanner.tsx` — when `gateKind === 'clarify'` render the scroll-to-composer pointer (no Review button); otherwise unchanged. ~20 LoC delta.
  - `ui/src/components/primitives/Sidebar.tsx` — the gate-nav callback for a run with `openGate.kind === 'clarify'` calls the run-open callback instead of the gate-open callback. ~10 LoC delta.
- **Skill template edited externally.**
  - `/Users/LUP1BG/Documents/claude-repo-scan/skills/claudboard-workflow/references/feature-workflow.template/SKILL.md.template` — Phase 1a guidance generalized to apply to every human-input site; Phase 1a-ws / Phase 3 / Phase 5 sections rewritten to call `clarify_request` rather than print prose; sub-agent relay pattern (`needsInput` in JSON result block) documented near the agent contract section. Separate commit in `claude-repo-scan`.
  - `/Users/LUP1BG/Documents/BoschProjects/meas/.claude/skills/feature-workflow/SKILL.md` — regenerated by re-running `/claudboard-workflow` after the template edit.
- **Tests.**
  - New `ClarifyComposer.test.tsx` (above).
  - Existing `ClarifyGate.test.tsx` is deleted with the component.
  - No server-side test changes — wire protocol is unchanged.
- **DB schema.** Unchanged.
- **REST API.** Unchanged.
- **WebSocket protocol.** Unchanged.
- **Behavior change observable to the user.**
  - Calling `clarify_request` no longer triggers a page navigation. The composer appears inline on the Active Run page.
  - The previously broken Phase 1a-ws affected-repos confirmation now actually pauses the run and accepts an answer instead of terminating silently.
  - Implementation-agent blocker reports and review-failure escalations now pause the run via the same composer instead of printing prose and stalling.
- **Out of scope.**
  - Letting sub-agents (architect, implementation, reviewer) call `clarify_request` directly mid-execution. The relay pattern (sub-agent returns `needsInput`, orchestrator asks, re-spawns) is sufficient and avoids harness changes.
  - The architect-agent live-stream visibility issue from the original bug report (the user explicitly deferred it).
  - Renaming `clarify_request` to a more generic name (`ask_user`, etc.). The wire name stays.
  - Per-question history / threading. One round of questions, one round of answers, then the orchestrator decides whether to ask again.
  - Preserving in-progress composer text across page reloads.
  - Time-limiting clarify rounds.
  - Replacing `gate_request` / `ReviewGate` with the inline composer. The spec+plan gate keeps its dedicated page deliberately.
