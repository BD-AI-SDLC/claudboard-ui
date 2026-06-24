## ADDED Requirements

### Requirement: Active Run Live stream renders SDK messages as structured entries

The Active Run screen's Live stream pane SHALL render each `transcript-message` WebSocket event as one or more structured entries derived from the SDK message envelope. The pane SHALL NOT display raw `JSON.stringify(message)` output for any message type.

The renderer SHALL produce a flat ordered list of entries of these kinds, each rendered as a distinct row:

- **header** — emitted once per run when the first `system` (init) message arrives. Shows the model name and the count of tools the SDK reported as available.
- **text** — emitted for each `text` block inside an `assistant` message's `content` array. Shows the agent label and the text with newlines preserved.
- **thinking** — emitted for each `thinking` block inside an `assistant` message's `content`. Shows the agent label and the thinking text, rendered with reduced visual emphasis (dimmed foreground). Thinking blocks are visible by default with no UI toggle.
- **tool** — emitted for each `tool_use` block inside an `assistant` message's `content`. Shows `⏺ <toolName>(<argSummary>)` on the primary line and `⎿ <resultPreview>` on a continuation line when the matching `tool_result` has been seen. The matching `tool_result` SHALL be located by `tool_use_id` and SHALL mutate the same entry rather than producing a separate entry. When `tool_result.is_error` is true the entry SHALL render with an error visual class.
- **footer** — emitted once per run when the SDK emits a `result` message. Shows the run duration in seconds and the total cost in USD.

Sub-agent messages (those whose envelope has a non-null `parent_tool_use_id`) SHALL be:

- labeled with the parent `Task` tool's `subagent_type` (falling back to its `description` and then to the literal string `"sub"`), and
- rendered indented one level deeper than top-level messages.

Top-level messages (envelope `parent_tool_use_id` is null) SHALL be labeled `"main"` and rendered at depth zero.

The argument summary SHALL be tool-aware:

- `Bash` → first line of `command`, truncated to 60 characters with `…` suffix when truncated
- `Read` / `Write` / `Edit` → the `file_path`
- `Grep` / `Glob` → the `pattern`
- `Task` → the `subagent_type` (falling back to `description`)
- Any other tool → the first key=value pair of the input, truncated to 60 characters

The result preview SHALL be tool-aware:

- For `Read`, render `"<n> lines"` where n is the line count of the result content (the file contents themselves are noise in the stream).
- For every other tool, render the first 3 lines of the normalized result content, each truncated to 200 characters, with a trailing `…` when content was elided.

The message-walking logic that produces the entry list SHALL live in a separate module `ui/src/components/ActiveRun/stream.ts` exporting a pure function `buildStream(events: WsEvent[]): StreamEntry[]` with no React imports. This module SHALL have unit tests covering each entry kind, sub-agent indentation, and error result flagging.

#### Scenario: Bash call with result renders as one paired tool entry

- **GIVEN** the SDK emits an assistant message containing a `tool_use` block with `name: "Bash"`, `id: "toolu_x"`, `input: { command: "ls server/src" }`, followed by a user message containing a `tool_result` with `tool_use_id: "toolu_x"`, `content: "app.ts\nbin.ts\ndb.ts\nws-server.ts"`, `is_error: false`
- **WHEN** the Live stream renders
- **THEN** exactly one tool entry appears with `toolName = "Bash"`, `argSummary = "ls server/src"`, and `resultPreview` containing the first 3 lines of the result
- **AND** the entry is rendered at depth zero with agent label `"main"`
- **AND** no `{"type":"tool_use",…}` JSON appears anywhere in the pane

#### Scenario: Sub-agent messages are indented and labeled by subagent_type

- **GIVEN** the top-level agent emits a `tool_use` for `Task` with `id: "toolu_task1"`, `input: { subagent_type: "sdd-expert-agent", description: "Generate BDD spec", prompt: "..." }`
- **AND** the SDK subsequently emits two assistant messages with `parent_tool_use_id: "toolu_task1"` — one containing a text block and one containing a `tool_use` block for `Write` with `file_path: "specs/foo.feature"`
- **WHEN** the Live stream renders
- **THEN** a top-level tool entry appears at depth 0 with `toolName = "Task"` and `argSummary = "sdd-expert-agent"`
- **AND** below it, two entries appear at depth 1 with agent label `"sdd-expert-agent"`: one text entry and one tool entry showing `Write(specs/foo.feature)`

#### Scenario: tool_result with is_error renders with an error class

- **GIVEN** a tool entry was emitted for a `Bash` `tool_use` with id `toolu_y`
- **WHEN** a `tool_result` arrives with `tool_use_id: "toolu_y"` and `is_error: true`
- **THEN** the same tool entry is mutated so its `isError` field is true
- **AND** the rendered row carries the `active-run__ev--error` (or equivalent error) class so the failure is visually distinct

#### Scenario: Thinking blocks render dimmed and always visible

- **GIVEN** the SDK emits an assistant message containing a `thinking` block with `thinking: "Reasoning about the file structure…"`
- **WHEN** the Live stream renders
- **THEN** a thinking entry appears in the stream
- **AND** the entry carries the `active-run__ev--thinking` class so it is visibly dimmed relative to text and tool entries
- **AND** no UI control to hide thinking blocks is present in this iteration

#### Scenario: System init produces exactly one header

- **GIVEN** the SDK emits a `system` message with `subtype: "init"`, `model: "claude-sonnet-4-6"`, and a `tools` array of length 18
- **WHEN** the Live stream renders
- **THEN** a single header entry appears as the first row showing the model and the tool count
- **AND** if further `system` messages arrive, no additional header entries are emitted

#### Scenario: Result produces a footer

- **GIVEN** the SDK emits a `result` message with `duration_ms: 47000` and `total_cost_usd: 0.12`
- **WHEN** the Live stream renders
- **THEN** a footer entry appears as the final row showing the duration in seconds and the cost

### Requirement: Active Run duration counters tick while the run is non-terminal

The Active Run screen SHALL re-render at least once per second while the run's status is not in a terminal state (`done` or `failed`), so that phase durations and agent durations in the Pipeline pane advance visibly without waiting for a WebSocket event or REST poll.

The re-render mechanism SHALL be a single `setInterval` driven from a `useEffect` whose dependency is the terminal-status boolean. When the run reaches a terminal status, the interval SHALL be cleared and no further ticks SHALL occur.

The `elapsed()` helper used by the Pipeline pane SHALL accept an optional `completedAt` upper bound. When `completedAt` is set, the helper SHALL compute elapsed time as `completedAt - startedAt` rather than `Date.now() - startedAt`, so a completed phase or agent freezes at its final duration instead of growing forever after completion. Call sites for phase durations and agent durations SHALL pass their respective `completedAt` values.

#### Scenario: Active phase counter ticks every second

- **GIVEN** a run is in `running` status with phase 1 marked active
- **WHEN** no WebSocket events or REST polls fire for 5 seconds
- **THEN** the rendered duration text on phase 1 advances by approximately 5 (modulo render scheduling) from its starting value
- **AND** the same applies to any active agent rows inside that phase

#### Scenario: Completed phase freezes at its final duration

- **GIVEN** phase 1 received a `phase-complete` event 30 seconds ago, while phase 2 is now active
- **WHEN** the tick interval fires
- **THEN** phase 1's rendered duration text remains constant at its completion value across ticks
- **AND** phase 2's rendered duration text continues to advance

#### Scenario: Tick stops on terminal status

- **GIVEN** a run reaches `done` status
- **WHEN** 10 seconds elapse with no further events
- **THEN** no further tick re-renders occur (the interval has been cleared)
- **AND** all phase and agent durations are frozen at their final values

### Requirement: Pipeline pane derives durations from event timestamps

The `buildPipelineFromEvents` helper in the Active Run screen SHALL derive every phase and agent timing (`startedAt`, `completedAt`) from the corresponding `WsEventBase.t` field of the originating event, NOT from `Date.now()`. This guarantees that re-invocations of the helper (which occur on every React re-render, including the 1-second tick added by the "duration counters tick" requirement above) produce stable timing values, so the `elapsed()` helper computes a true elapsed duration rather than zero.

The `phase-start` site SHALL preserve the existing `??` idiom so a duplicate `phase-start` event does not shift the timer.

#### Scenario: Repeated builder calls produce stable timings

- **GIVEN** a single `phase-start` event with `t = "2026-05-20T10:00:00.000Z"` and `payload.num = 1`
- **WHEN** `buildPipelineFromEvents` is called twice in succession (simulating two React re-renders)
- **THEN** the resulting phase's `startedAt` is identical between the two calls
- **AND** equal to `new Date("2026-05-20T10:00:00.000Z").getTime()`

#### Scenario: Active phase counter visibly advances

- **GIVEN** a run is in `running` status with phase 1 active for 30 seconds
- **WHEN** the 1-second tick effect fires
- **THEN** the rendered duration text on phase 1 reads approximately `30s` (modulo render scheduling)
- **AND** the value is monotonically non-decreasing across successive ticks

#### Scenario: Completed phase freezes at its real completion time

- **GIVEN** phase 1 received `phase-start` at `t1` and `phase-complete` at `t2` where `t2 - t1 = 47000ms`
- **WHEN** the Pipeline pane renders any time after `t2`
- **THEN** phase 1's rendered duration text reads `47s` and does not advance across ticks

### Requirement: Active phase body always expands

The Pipeline pane SHALL render the body (agents list, including the synthetic main row) whenever the phase status is `active` or `gate`, regardless of whether any sub-agents have been registered. The prior gating clause `ph.agents.length > 0` SHALL NOT be present.

#### Scenario: Phase 1 expands immediately on phase-start

- **GIVEN** a fresh run that has just emitted `phase-start { num: 1, title: "Ticket · Clarify · Specify · Plan" }` and no other events
- **WHEN** the Pipeline pane renders
- **THEN** phase 1's body is visible in the DOM with at least one agent row inside it
- **AND** the body remains visible across subsequent ticks until phase 1 receives `phase-complete`

### Requirement: Synthetic main row represents orchestrator activity per phase

The Pipeline pane SHALL prepend a synthetic agent row labeled `main` to every phase whose `startedAt` is set. The row's properties:

- `name: 'main'`
- `op`: the title of the most recently opened checkpoint within the phase that has not yet completed; falls back to the literal string `'orchestrating'` when no checkpoint is currently open
- `status: 'active'` while the phase is active or gated; `'done'` after `phase-complete`
- `startedAt`: equal to the phase's `startedAt`
- `completedAt`: equal to the phase's `completedAt` (undefined while the phase is active, so the row's elapsed timer ticks; set when the phase completes, so the timer freezes)

Pending phases (those with no `startedAt`) SHALL NOT have a main row.

The `buildPipelineFromEvents` helper SHALL consume `checkpoint-start` and `checkpoint-complete` WebSocket events (which were previously ignored) to track the current checkpoint per phase. The phase to which a checkpoint belongs SHALL be determined by which phase is active (`activeNum`) at the time the `checkpoint-start` event arrives.

The synthetic main row SHALL appear first in the phase's agent list. Sub-agent rows registered via `agent-start` continue to appear below it in arrival order.

#### Scenario: Main row appears the moment a phase starts

- **GIVEN** a fresh run that has emitted only `phase-start { num: 1 }`
- **WHEN** the Pipeline pane renders
- **THEN** phase 1's agent list contains exactly one row with `name === 'main'`, `op === 'orchestrating'`, `status === 'active'`

#### Scenario: Main row op tracks the current checkpoint

- **GIVEN** events `phase-start { num: 1 }`, then `checkpoint-start { num: 1, title: "1a. Clarify scope" }`
- **WHEN** the Pipeline pane renders
- **THEN** phase 1's main row has `op === "1a. Clarify scope"`

#### Scenario: Main row op reverts to orchestrating between checkpoints

- **GIVEN** events `phase-start { num: 1 }`, `checkpoint-start { num: 1, title: "1a. Clarify scope" }`, `checkpoint-complete { num: 1 }`
- **WHEN** the Pipeline pane renders
- **THEN** phase 1's main row has `op === "orchestrating"`

#### Scenario: Main row coexists with sub-agent rows

- **GIVEN** events `phase-start { num: 1 }`, `checkpoint-start { num: 1, title: "1a-ws. Affected repos" }`, `agent-start { name: "architect-agent", op: "infer-affected-repos" }`
- **WHEN** the Pipeline pane renders
- **THEN** phase 1's agent list contains exactly two rows in order: first `main` with `op === "1a-ws. Affected repos"`, then `architect-agent` with `op === "infer-affected-repos"`
- **AND** both rows display independently ticking elapsed timers

#### Scenario: Main row freezes when its phase completes

- **GIVEN** events `phase-start { num: 1, t: t1 }`, `phase-complete { num: 1, t: t2 }` where `t2 - t1 = 47s`
- **WHEN** the Pipeline pane renders any time after `t2`
- **THEN** phase 1's main row has `completedAt === t2`, `status === 'done'`, and its rendered duration reads `47s` across subsequent ticks

### Requirement: Theme respects OS preference on first load

The web UI SHALL detect the user's operating-system colour-scheme preference on first load and apply the corresponding theme by setting `data-theme` on the `<html>` element. The detection SHALL use `window.matchMedia('(prefers-color-scheme: light)')`. If the preference cannot be determined (e.g. the API is unavailable), the UI SHALL default to the dark theme.

The UI SHALL continue to honour OS-preference changes that occur after first load **only until the user explicitly picks a theme via the sidebar toggle**. After an explicit pick, subsequent OS-preference changes SHALL NOT alter the active theme for the remainder of the session.

#### Scenario: OS prefers light, no user interaction

- **GIVEN** the user's OS reports `prefers-color-scheme: light`
- **AND** the user has not interacted with the theme toggle in this session
- **WHEN** the app loads
- **THEN** `document.documentElement.dataset.theme` is set to `"light"` before the first render commits

#### Scenario: OS prefers dark, no user interaction

- **GIVEN** the user's OS reports `prefers-color-scheme: dark` (or no preference)
- **AND** the user has not interacted with the theme toggle in this session
- **WHEN** the app loads
- **THEN** `document.documentElement.dataset.theme` is set to `"dark"` before the first render commits

#### Scenario: OS preference flips while app is open, no user override

- **GIVEN** the app is loaded with `data-theme="dark"` because the OS prefers dark
- **AND** the user has not interacted with the theme toggle
- **WHEN** the user changes their OS to prefer light
- **THEN** `data-theme` updates to `"light"` and the UI re-paints with the light palette without a reload

#### Scenario: OS preference flips after user override

- **GIVEN** the app was loaded with `data-theme="dark"`
- **AND** the user clicked the sun icon, setting `data-theme="light"`
- **WHEN** the user changes their OS to prefer dark
- **THEN** `data-theme` remains `"light"` and the UI does not change

#### Scenario: Reload after override returns to OS preference

- **GIVEN** the user clicked the sun icon during a session, overriding the dark default to light
- **WHEN** the user reloads the page
- **AND** the OS preference is still dark
- **THEN** `data-theme` is `"dark"` on the new page load (the override does not persist)

### Requirement: Sidebar footer hosts a two-button theme toggle

The sidebar's footer SHALL render a segmented two-button control with a moon icon for dark and a sun icon for light. The button corresponding to the currently active theme SHALL be visually distinguished (background `var(--surface-3)`, foreground `var(--text)`) and SHALL carry `aria-pressed="true"`; the other button SHALL carry `aria-pressed="false"`.

Each button SHALL carry an `aria-label` of `"Dark"` or `"Light"` respectively. Clicking either button SHALL set the active theme to that button's value and SHALL count as an explicit user override for the purpose of OS-preference handling.

The control SHALL be present in the sidebar footer on every screen on which the sidebar is rendered (Dashboard, Project, Kickoff, Active Run, Review Gate).

#### Scenario: Toggle reflects active theme

- **GIVEN** `data-theme` is `"dark"`
- **WHEN** the user looks at the sidebar footer
- **THEN** the moon button is rendered in the active state with `aria-pressed="true"`
- **AND** the sun button is rendered in the inactive state with `aria-pressed="false"`

#### Scenario: Clicking sun switches to light

- **GIVEN** `data-theme` is `"dark"`
- **WHEN** the user clicks the sun button
- **THEN** `data-theme` becomes `"light"`
- **AND** the sun button becomes the active one with `aria-pressed="true"`
- **AND** the UI re-paints with the light palette

#### Scenario: Clicking moon switches to dark

- **GIVEN** `data-theme` is `"light"`
- **WHEN** the user clicks the moon button
- **THEN** `data-theme` becomes `"dark"`
- **AND** the moon button becomes the active one with `aria-pressed="true"`

#### Scenario: Toggle is reachable by keyboard

- **WHEN** the user tabs through the sidebar
- **THEN** focus reaches the moon button and the sun button as distinct stops
- **AND** pressing `Enter` or `Space` on a focused button activates it identically to a click

### Requirement: All screens are usable in both themes

Every screen rendered by the UI SHALL be visually correct and meet WCAG AA contrast for text and interactive elements in both `data-theme="dark"` and `data-theme="light"`. No screen SHALL contain colours that bypass the design-token system; all colours SHALL be expressed via CSS custom properties defined in `ui/src/styles/tokens.css`.

#### Scenario: Light-mode visual pass covers every screen

- **GIVEN** the app is running with `data-theme="light"`
- **WHEN** the user opens, in turn, the Dashboard, Project, Kickoff, Active Run, Review Gate, the project-picker modal, and the attach-repo modal
- **THEN** each screen renders with the light palette throughout — no dark surfaces, no invisible-on-light text, no broken chip contrast, no black-on-light or white-on-light leaks

### Requirement: CSS lint forbids hardcoded colour literals outside tokens

The CSS lint script (`ui/scripts/check-css-prefixes.js`, invoked by `npm run lint`) SHALL fail if any colour literal (`#rgb`, `#rrggbb`, `#rgba`, `#rrggbbaa`, `rgb(...)`, `rgba(...)`, `hsl(...)`, `hsla(...)`) appears in any `.css` file under `ui/src/` other than the allowlisted `ui/src/styles/tokens.css`.

Comments SHALL be stripped before scanning, so colour literals inside `/* … */` or `//` comments SHALL NOT cause the lint to fail.

#### Scenario: Hardcoded hex in component CSS fails lint

- **GIVEN** a component CSS file contains the rule `color: #ff0000;`
- **WHEN** `npm run lint` runs
- **THEN** the script exits non-zero
- **AND** the offending file path and the literal `#ff0000` are printed to stderr

#### Scenario: Hardcoded rgba in component CSS fails lint

- **GIVEN** a component CSS file contains the rule `background: rgba(0, 0, 0, 0.5);`
- **WHEN** `npm run lint` runs
- **THEN** the script exits non-zero
- **AND** the offending file path and the `rgba(...)` literal are printed to stderr

#### Scenario: Colour literal inside tokens.css passes lint

- **GIVEN** `ui/src/styles/tokens.css` contains the rule `--bg: #08090a;`
- **WHEN** `npm run lint` runs
- **THEN** the script does not flag this line

### Requirement: Active Run page renders an inline ClarifyComposer when a clarify gate is open

When the active run's `openGate.kind === 'clarify'`, the Active Run page SHALL render a `ClarifyComposer` component pinned below the live stream area. The composer SHALL:

- Read the gate's `payload.questions: string[]` from the run state populated by the existing `gate-request` WebSocket event handler.
- Render a single-line `<input>` labeled with the question text when `questions.length === 1` and the question is ≤80 characters.
- Render N labeled `<textarea>` elements stacked vertically otherwise (multiple questions, or any single question longer than 80 characters).
- Always render a Submit button and a Skip button. Submit POSTs `{ answers: string[] }` (index-aligned with `questions`) to `/api/runs/:runId/gate/:gateId/resolve`. Skip POSTs `{ skipped: true }`.
- Disable both buttons while a resolve request is in flight to prevent double-submit.
- Unmount when the `gate-resolved` WebSocket event clears `openGate` in the run state.

The composer SHALL NOT enforce that all inputs be non-empty before Submit is enabled. Empty strings are semantically "no preference, you decide" — the orchestrator interprets blanks.

The composer's pinned position SHALL NOT interfere with the live stream's existing auto-scroll behavior: stream messages continue to append above the composer as they arrive.

#### Scenario: Single-question short clarify renders as single-line input

- **GIVEN** an active run with `openGate.kind === 'clarify'` and `payload.questions = ["Which workspace are we targeting?"]`
- **WHEN** the Active Run page renders
- **THEN** a single-line `<input>` is rendered below the live stream
- **AND** no separate gate page is opened

#### Scenario: Multi-question clarify renders as stacked textareas

- **GIVEN** an active run with `openGate.kind === 'clarify'` and `payload.questions` containing three questions
- **WHEN** the Active Run page renders
- **THEN** three labeled `<textarea>` elements are rendered, one per question, in order

#### Scenario: Long single question renders as textarea, not single-line input

- **GIVEN** an active run with `openGate.kind === 'clarify'` and one question whose length exceeds 80 characters
- **WHEN** the Active Run page renders
- **THEN** a `<textarea>` is rendered, not a single-line `<input>`

#### Scenario: Submit posts index-aligned answers

- **GIVEN** the composer is rendered with three questions and the user has typed `"a"`, `""`, `"c"` into the three fields (the middle field left empty)
- **WHEN** the user submits
- **THEN** the client POSTs `{ answers: ["a", "", "c"] }` to the resolve endpoint

#### Scenario: Skip posts the skip flag

- **GIVEN** the composer is rendered (any number of questions, any content)
- **WHEN** the user clicks Skip
- **THEN** the client POSTs `{ skipped: true }` to the resolve endpoint

#### Scenario: Composer unmounts on gate-resolved

- **GIVEN** the composer is rendered for an open clarify gate
- **WHEN** the `gate-resolved` WebSocket event arrives for this gate
- **THEN** the composer is no longer mounted on the page
- **AND** the live stream continues to receive subsequent run output

### Requirement: ClarifyComposer keyboard affordances

The `ClarifyComposer` SHALL support keyboard shortcuts as follows:

- **Single-input layout** (one short question): Enter submits the answer. Shift+Enter is not applicable (single-line `<input>`).
- **Multi-input layout** (textareas): Enter inserts a newline inside the focused textarea (default browser behavior). Cmd+Enter (macOS) or Ctrl+Enter (other platforms) submits all answers from any focused field. Tab moves focus to the next field; Shift+Tab to the previous.

Both layouts also support clicking Submit or Skip with the pointer. Keyboard support is an additive affordance, not a substitute.

#### Scenario: Enter submits a single-input composer

- **GIVEN** the composer is rendered with one short question and the user has typed `"meas"` into the input
- **WHEN** the user presses Enter
- **THEN** the client POSTs `{ answers: ["meas"] }` to the resolve endpoint

#### Scenario: Cmd-Enter submits a multi-input composer

- **GIVEN** the composer is rendered with two questions and the user has typed answers into both textareas, focus in either textarea
- **WHEN** the user presses Cmd+Enter (macOS) or Ctrl+Enter (other platforms)
- **THEN** the client POSTs `{ answers: ["<first>", "<second>"] }` to the resolve endpoint

#### Scenario: Enter in a textarea inserts a newline, does not submit

- **GIVEN** the composer is rendered as multi-input with focus in one textarea
- **WHEN** the user presses Enter (without modifier)
- **THEN** a newline is inserted in the textarea
- **AND** no submit is triggered

### Requirement: Gate routing in App.tsx branches on gate kind

The `App.tsx` gate route SHALL branch on the gate's `kind`:

- `kind === 'spec+plan'` → mount `<ReviewGate>` (existing behavior, unchanged).
- `kind === 'clarify'` → do NOT mount a page component. Instead, change the application route to the Active Run page for the gate's owning `runId`. The inline `<ClarifyComposer>` on Active Run renders the gate.
- Unknown kinds → fall back to mounting `<ReviewGate>` so the user sees *something* rather than a blank screen.

The kind continues to be threaded into the route at navigation time as established by `add-clarification-gate` (the `gate-request` event carries `gateKind`; the runs list carries `openGate.kind`).

#### Scenario: Spec+plan gate continues to use ReviewGate

- **GIVEN** an active run with an open spec+plan gate
- **WHEN** the user clicks the gate banner's Review button
- **THEN** the App route changes to `'gate'` with `gateKind === 'spec+plan'`
- **AND** the `<ReviewGate>` component is mounted

#### Scenario: Clarify gate does not open a separate page

- **GIVEN** an active run with an open clarify gate
- **WHEN** the user navigates to the gate (via banner pointer, sidebar click, or direct URL to `/gate/:gateId`)
- **THEN** the App route resolves to the Active Run page for the gate's owning run
- **AND** no `ClarifyGate` page component is mounted (because the component no longer exists)
- **AND** the inline `<ClarifyComposer>` is visible at the bottom of Active Run

#### Scenario: Sidebar opens Active Run for clarify gates

- **GIVEN** a run with `openGate.kind === 'clarify'` in the sidebar's runs list
- **WHEN** the user clicks the run's entry in the sidebar
- **THEN** the Active Run page opens for that run
- **AND** the composer is already visible at the bottom

### Requirement: RunBanner copy reflects the gate kind

The `RunBanner` SHALL render different content depending on the gate's kind:

- `clarify` → render a one-line pointer "Awaiting your input below" (or equivalent wording). The pointer SHALL be clickable; clicking it scrolls the page to the inline `ClarifyComposer` via `element.scrollIntoView({ behavior: 'smooth', block: 'end' })`. No "Review" button.
- `spec+plan` (or any other) → existing copy and Review button (unchanged from the prior `add-clarification-gate` requirement; the prior wording "review spec + plan to continue" stays).

#### Scenario: Banner for a clarify gate points to the composer

- **GIVEN** a run is in `paused-gate` with an open clarify gate
- **WHEN** the Active Run screen renders the banner
- **THEN** the banner shows a "Awaiting your input below" pointer
- **AND** the banner does NOT show a "Review" button
- **AND** clicking the pointer scrolls the page so the ClarifyComposer is in view

#### Scenario: Banner for a spec+plan gate still uses Review button

- **GIVEN** a run is in `paused-gate` with an open spec+plan gate
- **WHEN** the Active Run screen renders the banner
- **THEN** the banner shows the existing "review spec + plan to continue" copy
- **AND** the banner shows a clickable "Review" button that navigates to `ReviewGate`

### Requirement: Vanilla React stack with no UI libraries

The UI SHALL be built with Vite + React 18 + TypeScript. It SHALL NOT depend on Tailwind, shadcn, Radix, MUI, Chakra, Mantine, DaisyUI, styled-components, Emotion, or any other UI component or CSS-in-JS library. Styling SHALL be plain CSS in per-component `.css` files imported alongside their `.tsx`.

#### Scenario: Dependency check excludes UI libraries

- **WHEN** the UI's `package.json` is inspected
- **THEN** none of: tailwindcss, @shadcn/*, @radix-ui/*, @mui/*, @chakra-ui/*, @mantine/*, daisyui, styled-components, @emotion/* appear in dependencies or devDependencies

#### Scenario: CSS files are colocated with components

- **WHEN** a component file `src/components/RunBanner.tsx` exists
- **THEN** its styles live in `src/components/RunBanner.css`, imported as the first statement of the `.tsx` file

### Requirement: Five screens at visual parity with bosch-workflow

The UI SHALL implement five screens with layouts, typography, color tokens, spacing, and component shapes that visually match the bosch-workflow design at `/Users/LUP1BG/Documents/BoschProjects/bosch-workflow/project`:

- **Dashboard** — workspace overview, metrics tiles, repository list with health bars, recent runs panel, "vertical operations" grid.
- **Project** — per-Project deep view including prereq panel.
- **Kickoff** — feature prompt entry and submit. No scope picker for any topology; the form is identical regardless of the Project's `topology` value.
- **Active Run** — split view with phases/agents (left), live stream (middle), telemetry rail (right), run banner with gate CTA when applicable.
- **Review Gate** — spec + plan side-by-side, approve / request-changes actions.

Each screen SHALL use the Geist and Geist Mono fonts and the existing color tokens (`--teal`, `--amber`, `--violet`, `--bg`, `--bg-2`, `--text`, `--text-2`, `--muted`, `--dim`, `--border`).

The `Project.topology` value MAY be rendered as a display badge on the Project card and Project view (e.g. "Monolith" / "Monorepo" / "Workspace"), but SHALL NOT drive any branching in form layout, kickoff inputs, or submitted request shape.

#### Scenario: Dashboard renders all required regions

- **WHEN** the user opens the dashboard with at least one Project registered
- **THEN** the page shows: topbar with crumb + Start-feature CTA, h1 title, four metric tiles (active runs, awaiting gate, in review, merged this week), repositories card with rows matching the design's grid, recent runs panel, and the vertical operations grid

#### Scenario: Kickoff form is identical across topologies

- **WHEN** the user opens the Kickoff screen for a monolith Project
- **THEN** the form shows a prompt textarea and a submit button, with no scope dropdown
- **AND WHEN** the user opens the Kickoff screen for a monorepo Project
- **THEN** the form is identical — no scope dropdown is rendered
- **AND WHEN** the user opens the Kickoff screen for a multi-repo-workspace Project
- **THEN** the form is identical — no scope dropdown is rendered

#### Scenario: Kickoff submits a prompt-only request

- **WHEN** the user submits the Kickoff form with prompt `"Add invoice PDF"` for any Project
- **THEN** the UI POSTs `/api/runs` with body `{ projectId, target, prompt: "Add invoice PDF" }`
- **AND** the request body does NOT include a `scope` field
- **AND** the request body does NOT include a `workspaceRoot` field

#### Scenario: Active Run shows three panes

- **WHEN** the user opens a running run in the default `split` layout
- **THEN** the page shows three panes — Pipeline (left), Live stream (middle), Run telemetry (right) — with the run banner at the top

#### Scenario: Review Gate shows spec and plan

- **WHEN** the user navigates to an open gate via the Run banner's "Review spec + plan" CTA
- **THEN** the page renders the BDD spec text with Gherkin keyword highlighting and the architect plan as a numbered list of checkpoints with files and contracts; two action buttons are present: "Approve" and "Request changes"

#### Scenario: Topology badge is informational

- **WHEN** a Project card renders a `topology` badge
- **THEN** the badge text reflects the topology (e.g. "Workspace" for `multi-repo-workspace`)
- **AND** clicking the card behaves identically regardless of topology — it routes to the Project view for that single Project

### Requirement: Live data over REST and WebSocket

The UI SHALL fetch initial data via REST endpoints and subscribe to live updates via WebSocket. There SHALL be no mock data shipped in the production build. **The Dashboard activity / recent runs panel SHALL render real run data only; no hardcoded sample feed SHALL exist in the production bundle.**

#### Scenario: Dashboard fetches from REST

- **WHEN** the dashboard mounts
- **THEN** it calls `GET /api/dashboard/summary` and `GET /api/projects` and `GET /api/runs`; no `window.DATA` global exists in the production bundle **and no `STATIC_FEED` constant is bundled**

#### Scenario: Active Run subscribes via WebSocket

- **WHEN** the user opens an active run page
- **THEN** the page opens a WS connection to `/api/runs/:id/stream`, replays the buffered events to build initial state, then updates the pipeline/stream/telemetry incrementally

#### Scenario: Dashboard recent runs panel renders live data

- **WHEN** the dashboard renders with one or more runs in the database
- **THEN** the panel displays the 5 most recent runs (by `createdAt` descending), each row showing status chip, project name, prompt summary (max 60 chars), and relative age; clicking a row navigates to that Run view

#### Scenario: Dashboard recent runs panel empty state

- **WHEN** the dashboard renders with zero runs in the database
- **THEN** the panel displays the message "No runs yet — start a feature from any project."

### Requirement: Gate approval flow

The Review Gate screen SHALL provide actions to approve or reject the open gate. Approve SHALL POST `{ result: "approved" }`; reject SHALL open a small inline form for the change request text and POST `{ result: "rejected", changes }`.

#### Scenario: Approve closes the gate and returns to the Run view

- **WHEN** the user clicks "Approve" on the Review Gate screen
- **THEN** the UI POSTs to `/api/runs/:id/gate/:gate_id/resolve` with `{ result: "approved" }`, the gate UI dismisses, and the user lands back on the Active Run view which now shows the workflow advancing past the gate

#### Scenario: Request changes captures feedback

- **WHEN** the user clicks "Request changes", enters text, and submits
- **THEN** the UI POSTs `{ result: "rejected", changes: <text> }` and dismisses; the run banner reflects the SKILL's next move (typically re-running the gated agents)

### Requirement: Class name prefix convention

All component-defined CSS classes SHALL be prefixed by a screen or component identifier (e.g. `run-banner__title`, `gate-step__keyword`, `dash-grid__card`) to avoid global collisions in the absence of CSS modules.

#### Scenario: Lint catches unprefixed classes

- **WHEN** a developer adds a class `.title` (no prefix) in a component CSS file
- **THEN** the CSS lint step fails CI with a message naming the offending class and file

### Requirement: Sidebar items are context-aware

Sidebar navigation items that target a screen requiring a `projectId`, `runId`, or `gateId` SHALL be enabled only when a sensible default target exists, and SHALL be visibly disabled with an explanatory tooltip otherwise. Enabled clicks SHALL smart-pick the target according to a documented rule per item.

| Item | Enabled when | Smart target | Disabled tooltip |
|---|---|---|---|
| Overview | always | dashboard | n/a |
| Project setup | ≥1 active project | last-visited project if still active, else first by `createdAt` | "Attach a repo first" |
| Start feature | ≥1 active project | 1 project → Kickoff for that project; N → open picker modal | "Attach a repo first" |
| Active run | ≥1 run with status `running` or `paused-user` | most recent by `createdAt` desc | "No active runs" |
| Review gate | ≥1 run with status `paused-gate` and a non-null `openGate` | oldest open gate by `createdAt` asc | "No gates awaiting review" |

The History / Skills / Rules / Settings items SHALL always render disabled in this change with tooltip "Coming soon" until their screens are built.

#### Scenario: Disabled sidebar item does not navigate

- **WHEN** the user clicks a disabled sidebar item
- **THEN** no route change occurs and no callback fires; the item's `aria-disabled` attribute is `"true"` and `pointer-events` is `none` in CSS

#### Scenario: Tooltip surfaces reason

- **WHEN** the user hovers a disabled sidebar item
- **THEN** the browser-native `title` attribute reveals the documented per-item reason text

#### Scenario: Sidebar "Active run" jumps to the latest active run

- **WHEN** there is one run with status `running` (id `r1`, `createdAt = T`) and one with status `paused-gate` (id `r2`, `createdAt = T-10m`)
- **THEN** clicking sidebar "Active run" navigates to `/run` with `runId = r1` (paused-gate is not eligible for this item)

#### Scenario: Sidebar "Review gate" jumps to the oldest open gate

- **WHEN** there are two runs with status `paused-gate`, with open gates created at T-30m and T-5m
- **THEN** clicking sidebar "Review gate" navigates to `/gate` with the T-30m gate

#### Scenario: Sidebar items react to state changes

- **WHEN** the user attaches their first repo
- **THEN** the sidebar "Project setup" and "Start feature" items transition from disabled to enabled without a page reload

### Requirement: Dashboard Start-feature CTA with smart project selection

The Dashboard TopBar SHALL render a "Start feature" CTA whose behaviour depends on the number of active projects:

- **0 projects**: button hidden (the empty state CTA "Attach your first repo" is the primary action).
- **1 project**: clicking immediately navigates to the Kickoff screen with that project selected.
- **N ≥ 2 projects**: clicking opens a project picker modal listing all active projects; selecting one navigates to Kickoff with that project selected.

#### Scenario: Single project auto-selects

- **WHEN** the workspace contains exactly one active project and the user clicks the Dashboard TopBar "Start feature" CTA
- **THEN** the app navigates to the Kickoff screen with that project's id pre-selected, without showing a picker

#### Scenario: Multiple projects show picker

- **WHEN** the workspace contains two or more active projects and the user clicks "Start feature"
- **THEN** a modal overlay appears listing all active projects (name + path); selecting one navigates to Kickoff with that project; `Esc` or backdrop click closes the modal without navigating

### Requirement: Project picker modal

A `ProjectPicker` modal component SHALL render an overlay listing active projects for selection. It SHALL be keyboard-accessible (`Esc` to cancel, arrow keys to move, `Enter` to select) and SHALL close on backdrop click.

#### Scenario: Picker lists name and path

- **WHEN** the picker opens with projects `[{name: "craftsphere", path: "/a"}, {name: "portal", path: "/b"}]`
- **THEN** each entry renders the project name and the path in a monospaced font

#### Scenario: Esc cancels

- **WHEN** the picker is open and the user presses `Esc`
- **THEN** the picker closes and no navigation occurs

### Requirement: Directory-browser modal for attach repo

The "Attach repo" flow SHALL use a modal that browses the host filesystem starting at the server's `homedir()`, instead of a free-text input. A paste-path fallback SHALL be available within the same modal for power users.

#### Scenario: Modal opens at home directory

- **WHEN** the user clicks "Attach repo" (or the empty-state "Attach your first repo" CTA)
- **THEN** a modal opens calling `GET /api/fs/browse` with no `path` query; the response's `path` field equals the server's `homedir()` and its `entries` are rendered as a list

#### Scenario: Navigating into a folder updates the listing

- **WHEN** the modal shows the home directory and the user clicks an entry named `Documents`
- **THEN** the modal calls `GET /api/fs/browse?path=<home>/Documents` and replaces the listing with the response; the breadcrumb updates to reflect the new path

#### Scenario: Git repos are visually marked

- **WHEN** an entry has `isGitRepo: true` in the browse response
- **THEN** the entry renders with a git glyph alongside its name

#### Scenario: Use this folder attaches the current path

- **WHEN** the user clicks "Use this folder" with the modal at path `/Users/lup1bg/code/myrepo`
- **THEN** the UI calls `POST /api/workspaces` with `{ root: "/Users/lup1bg/code/myrepo" }`, closes the modal on 201, and refreshes the projects list

#### Scenario: Paste path fallback

- **WHEN** the user clicks the "Paste path" toggle, types an absolute path, and submits
- **THEN** the same `POST /api/workspaces` call is made with that path, bypassing folder-by-folder navigation

#### Scenario: Error surfaces inline

- **WHEN** the user tries to navigate into a directory the server cannot read (`GET /api/fs/browse` returns 403)
- **THEN** the modal stays open and renders an inline error message; the previous listing is preserved

### Requirement: App-level shared state for projects and runs

The App component SHALL hold `projects` and `runs` as shared state, fetched on mount and refreshed on the events listed below. Child screens and the Sidebar SHALL consume this shared state rather than fetching independently.

Refetch triggers:

- App mount
- After successful `POST /api/workspaces` (attach repo) — refresh `projects`
- After successful `POST /api/runs` (start feature) — refresh `runs`
- Every 30 seconds while mounted — refresh `runs` (to keep sidebar enable-state fresh without WS)

#### Scenario: Attach refreshes projects everywhere

- **WHEN** the user successfully attaches a repo via the modal
- **THEN** the Dashboard repository list, the sidebar enable-state, and the picker contents all reflect the new project without a page reload

#### Scenario: New run appears in recent runs panel

- **WHEN** the user successfully creates a run via Kickoff
- **THEN** within at most 30 seconds the Dashboard "Recent runs" panel includes that run

### Requirement: Disabled sidebar items styling

Disabled sidebar items SHALL render with reduced opacity (~0.4), `cursor: not-allowed`, and `pointer-events: none`. They SHALL retain `aria-disabled="true"` for assistive tech.

#### Scenario: Disabled item is not focusable by tab

- **WHEN** the user tabs through the sidebar
- **THEN** disabled items are skipped (`tabIndex={-1}`) but remain visible

### Requirement: Sidebar header renders the claudboard brand mark and two-tone wordmark

The Sidebar header SHALL render the canonical claudboard brand identity: a tile-glyph mark followed by the wordmark `claud` + `board` and the version pill.

The mark SHALL be implemented as a reusable primitive `<BrandMark />` exposing the design system's "knockout" tile: a teal square tile with two cells punched out — a primary cell at SVG coordinates `(5,12)` sized `7×7` with `rx=2` at full opacity, and a ghost cell at `(12,5)` sized `7×7` with `rx=2` at opacity `0.32`. Both cells SHALL reveal the surface colour behind the tile via a theme-aware CSS custom property (`--brand-cutout`, defaulting to the dark page background).

The wordmark SHALL render `claud` in lower-case in the primary text colour and `board` in lower-case in the teal accent colour, without a coloured box, padding, or border-radius around either word. The two spans SHALL be visually adjacent (no horizontal gap between them).

The previously-present `"Not for 5 year olds"` tagline element SHALL be removed entirely; the Sidebar header SHALL contain no tagline line beneath the brand row.

#### Scenario: Sidebar header includes the brand mark glyph

- **GIVEN** the app is mounted with a Sidebar
- **WHEN** the Sidebar renders
- **THEN** the `.sidebar__brand` element contains a `<BrandMark>` glyph as its first child
- **AND** the glyph renders an inline `<svg viewBox="0 0 24 24">` with exactly two `<rect>` cells at the documented coordinates
- **AND** the glyph wrapper has the teal tile background and a corner radius equal to 24% of its rendered size

#### Scenario: Wordmark is two-tone teal, not boxed

- **WHEN** the Sidebar brand row renders
- **THEN** the `claud` span has the primary text colour and no background
- **AND** the `board` span has the teal accent colour and no `background`, `padding`, or `border-radius`
- **AND** both spans render lower-case text matching the design wordmark exactly

#### Scenario: The "Not for 5 year olds" tagline is gone

- **WHEN** the Sidebar renders
- **THEN** no element with class `sidebar__brand-tagline` appears in the DOM
- **AND** the text `"Not for 5 year olds"` does not appear anywhere in the Sidebar

### Requirement: BrandMark supports an inverted variant for use on accent surfaces

The `<BrandMark variant="inverted" />` variant SHALL render with an inverted figure/ground: a `--surface-2` tile background with teal-coloured cells. This allows the mark to be placed on a teal-accent surface without disappearing into the background.

#### Scenario: Inverted variant flips tile and cells

- **GIVEN** a `<BrandMark variant="inverted" />` is rendered
- **WHEN** computed styles are inspected
- **THEN** the wrapper background is `--surface-2` (not teal)
- **AND** the cell `fill` is the teal accent (not the cutout colour)
- **AND** the ghost cell's opacity rule still applies, so the relative weight of primary vs ghost is preserved

### Requirement: Browser tab shows the claudboard identity

The browser tab and bookmark surfaces SHALL identify the app as `claudboard`, not `Bosch SDLC` or any prior working name. The page `<title>` SHALL be `claudboard`. The page SHALL declare an SVG favicon (`/favicon.svg`) whose mark geometry is identical to the inline `BrandMark` primitive — same viewBox, same two cells at the same coordinates, same tile radius scaling — so the favicon and the sidebar glyph read as the same mark at every size.

#### Scenario: index.html declares the SVG favicon and claudboard title

- **GIVEN** the built `ui/index.html` is served
- **WHEN** the document head is parsed
- **THEN** `<title>` is `claudboard`
- **AND** a `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` element is present
- **AND** the served `/favicon.svg` contains the knockout mark: one teal tile rect with `rx=5.76`, one primary cell at `(5,12)` `7×7`, one ghost cell at `(12,5)` `7×7` with `opacity=0.32`

### Requirement: Foundation setup banner and operation cards address the user with the product name "Claudboard"

The foundation setup banner (`SetupBanner`) and the foundation/maintenance operation cards (`OperationCard`, fed from `setup-utils.ts`) SHALL refer to the product as `Claudboard` in user-visible copy. The earlier working name `Mileva` SHALL NOT appear in any rendered string.

The five operation `cmd` strings displayed to the user SHALL use the `claudboard-` prefix, not the `mileva-` prefix:

- `analyse` → display `/claudboard-analyse`
- `generate` → display `/claudboard-generate`
- `claudboard-workflow` → display `/claudboard-workflow`
- `refresh` → display `/claudboard-refresh`
- `techdebt` → display `/claudboard-techdebt`

These strings are display affordances only. The server-side prereq runner (`server/src/prereq/cli-runner.ts`) continues to invoke the canonical namespaced plugin commands (`/claudboard:claudboard-analyse`, etc.); the UI's short form is for readability and does not need to be a literal invocation target.

The operation `id` keys (`analyse`, `generate`, `claudboard-workflow`, `refresh`, `techdebt`) SHALL NOT change — they are the routing keys for prereq state lookup and dependency declarations.

#### Scenario: SetupBanner headline names Claudboard

- **GIVEN** a project where at least one foundation op is `missing`
- **WHEN** the `SetupBanner` renders
- **THEN** the headline text is `"Set up Claudboard for this repo"`
- **AND** the headline text does not contain the substring `"Mileva"` (case-insensitive)

#### Scenario: Operation CTA buttons use the claudboard- command prefix

- **GIVEN** a project where the foundation has a `next` op at the `analyse` step
- **WHEN** the `SetupBanner` CTA renders
- **THEN** the button label is `"▶ Run /claudboard-analyse"`
- **AND** no rendered string anywhere in the Project view contains `/mileva-`

#### Scenario: Foundation routing keys are unchanged

- **GIVEN** a `prereqs` record keyed by the existing `id` values (`analyse`, `generate`, `claudboard-workflow`)
- **WHEN** `deriveFoundationStates(prereqs, running)` is called
- **THEN** it returns derived states for each of the three foundation ops in the same order and against the same keys as before the rename
- **AND** the resulting `VisualState` values match the pre-rename behaviour for identical inputs
