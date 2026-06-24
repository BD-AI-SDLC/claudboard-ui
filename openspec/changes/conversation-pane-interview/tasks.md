## 1. Protocol: extend ClarifyRequestSchema for structured questions

- [x] 1.1 In `protocol/src/mcp-schemas.ts`, define a `ClarifyQuestionOptionSchema`:
  ```
  z.object({ label: z.string().min(1), description: z.string().optional() })
  ```
- [x] 1.2 Define a `ClarifyQuestionSchema`:
  ```
  z.object({
    text: z.string().min(1),
    group: z.string().optional(),
    why: z.string().optional(),
    options: z.array(ClarifyQuestionOptionSchema).optional(),
  })
  ```
- [x] 1.3 Update `ClarifyRequestSchema` to accept both shapes:
  ```
  z.object({
    questions: z.array(z.union([z.string().min(1), ClarifyQuestionSchema])).min(1),
  })
  ```
  This preserves backward compat: `{ questions: ["What topic?"] }` still validates.
- [x] 1.4 Export `ClarifyQuestionSchema`, `ClarifyQuestionOptionSchema`, and their inferred types.

## 2. Protocol: update ClarifyPayload and ClarifyResolution types

- [x] 2.1 In `protocol/src/types.ts`, update `ClarifyPayload`:
  ```typescript
  export interface ClarifyQuestionOption { label: string; description?: string }
  export interface ClarifyQuestion { text: string; group?: string; why?: string; options?: ClarifyQuestionOption[] }
  export interface ClarifyPayload { questions: Array<string | ClarifyQuestion> }
  ```
- [x] 2.2 Add a `ClarifyAnswer` type and update `ClarifyResolution`:
  ```typescript
  export interface ClarifyAnswer { selected?: number; note?: string }
  export type ClarifyResolution = { answers: Array<string | ClarifyAnswer> } | { skipped: true }
  ```
  This preserves backward compat: `{ answers: ["my text"] }` is still a valid resolution.
- [x] 2.3 Export new types from `protocol/src/index.ts`.

## 3. Server: update clarify_request MCP tool and resolve endpoint

- [x] 3.1 In `server/src/gate/mcp-server.ts`, update the `clarify_request` tool to use the new `ClarifyRequestSchema` from the protocol package (it already imports it — the shape just changes).
- [x] 3.2 In `server/src/gate/routes.ts`, update `ClarifyAnswersBodySchema` to accept both `string[]` and the new `ClarifyAnswer[]` shape:
  ```
  z.object({ answers: z.array(z.union([z.string(), z.object({ selected: z.number().optional(), note: z.string().optional() })])) })
  ```
- [x] 3.3 Update `server/src/gate/__tests__/clarify-request.test.ts`:
  - Existing tests for `questions: string[]` still pass (backward compat).
  - New test: structured question with options validates.
  - New test: structured answer `{ selected: 0, note: "..." }` validates and resolves.

## 4. UI: build InterviewPane component

- [x] 4.1 Create `ui/src/components/InterviewPane/InterviewPane.tsx`. Props:
  ```typescript
  interface InterviewPaneProps {
    runId: string
    gateId: string
    questions: Array<string | ClarifyQuestion>
    onResolved?: () => void
  }
  ```
  Internal state:
  - `currentIndex: number` — which question is active (0-based).
  - `answers: Array<ClarifyAnswer>` — one per question, initialized to `{}`.
  - `resolving: boolean`.

- [x] 4.2 **Normalize questions**: on mount, map each question to its structured form. If a question is a plain string, convert to `{ text: string }` with no group/why/options.

- [x] 4.3 **Conversation thread**: render the body as a scrollable column of bubble pairs. For each question at index `< currentIndex`, render:
  - An agent bubble with the question text (and group label as a meta tag above).
  - A user bubble with the selected option label (or note text if no options).
  - Clicking the user answer bubble navigates back to that question (`setCurrentIndex(i)`).

- [x] 4.4 **Active question card**: for the question at `currentIndex`, render a violet-bordered card containing:
  - Group label chip (if `group` exists).
  - Question text (large).
  - "Why" callout block (if `why` exists): italic, muted, with a left border.
  - If `options` exist: render radio-style option cards. Each shows a radio indicator, label, and description. Clicking selects (`answers[currentIndex].selected = optionIndex`). The selected option gets a teal/violet highlight.
  - A text input for an optional note (`answers[currentIndex].note`).
  - Action bar: `[Previous]` (if index > 0), `[Skip]`, `[Submit answer →]` / `[Finish interview →]` (if last question).

- [x] 4.5 **Navigation**:
  - "Previous" button: `setCurrentIndex(i => i - 1)`.
  - "Next question →" / "Submit answer →": saves the current answer and advances. If no option is selected AND no note is typed AND options exist, treat as skipped for that question.
  - Clicking a previously answered bubble pair: `setCurrentIndex(clickedIndex)` — the card re-opens with the previous answer pre-filled for editing.
  - On the last question, the button says "Finish interview →" and triggers submit of ALL answers.

- [x] 4.6 **Submit handler**: `api.resolveGate(runId, gateId, { answers })` where answers is the `ClarifyAnswer[]`. For questions where only a note was typed (no options to select), send `{ note: "..." }`. For questions where an option was selected, send `{ selected: N, note?: "..." }`. For legacy compat fallback: if all questions were plain strings and no options existed, send `{ answers: string[] }` (the note text for each).

- [x] 4.7 **Skip handler**: `api.resolveGate(runId, gateId, { skipped: true })`. Skips the entire interview.

## 5. UI: build ProgressRail component

- [x] 5.1 Create `ui/src/components/InterviewPane/ProgressRail.tsx`. Props:
  ```typescript
  interface ProgressRailProps {
    questions: Array<NormalizedQuestion>
    answers: Array<ClarifyAnswer>
    currentIndex: number
    onNavigate: (index: number) => void
  }
  ```
- [x] 5.2 Render a vertical list of question entries, each showing:
  - A numbered circle: green checkmark for answered, violet highlight for current, grey for pending.
  - Group label (small, uppercase).
  - Truncated question text.
  - For answered questions: the selected answer label in green monospace.
  - Clicking an entry calls `onNavigate(index)`.

- [x] 5.3 Below the question list, render a "Next steps" section showing what happens after the interview (static text: "patch Jira description → hand off to sdd-expert → architect-agent → human gate at phase 1d"). This can be hardcoded for now since the workflow is fixed.

## 6. UI: InterviewPane CSS

- [x] 6.1 Create `ui/src/components/InterviewPane/InterviewPane.css` with styles for:
  - `.interview-pane__root` — fills the middle pane area.
  - `.interview-pane__header` — "Clarify scope · conversation · N / M" with violet accent dot.
  - `.interview-pane__thread` — scrollable conversation body.
  - `.interview-pane__bubble-row` — container for agent+user bubble pair.
  - `.interview-pane__bubble--agent` — agent question bubble (dark surface, border).
  - `.interview-pane__bubble--user` — user answer bubble (teal-tinted, right-aligned).
  - `.interview-pane__bubble--user:hover` — cursor pointer, subtle highlight to indicate clickability.
  - `.interview-pane__active-card` — violet-glowing current question card.
  - `.interview-pane__why` — italic callout with left border.
  - `.interview-pane__option` — radio-style option card.
  - `.interview-pane__option--selected` — teal highlight on selected option.
  - `.interview-pane__note-input` — optional note field.
  - `.interview-pane__actions` — action bar with keyboard hint.
  - Progress rail styles (`--rail` prefix).
  All using existing CSS custom properties (`--violet`, `--teal`, `--surface`, etc.).

## 7. UI: mount InterviewPane in ActiveRun

- [x] 7.1 In `ActiveRun.tsx`, detect when `status === 'paused-gate'` and `gateKind === 'clarify'`. Extract questions from `gateEvent.payload.gatePayload.questions`.

- [x] 7.2 When in interview mode:
  - **Middle pane**: render `<InterviewPane>` instead of the stream `<div>` and the old `<ClarifyComposer>`. The stream div is hidden (not unmounted, so scroll position is preserved for when the interview ends).
  - **Right pane**: render `<ProgressRail>` instead of the telemetry section. The telemetry section is hidden (not unmounted).

- [x] 7.3 When the gate resolves (gate-resolved event arrives, `status` changes from `paused-gate`), both panes revert to their normal content (stream + telemetry).

- [x] 7.4 Remove the `<ClarifyComposer>` mount and import. Remove the `clarifyComposerRef` scroll logic.

## 8. UI: update RunBanner for interview progress

- [x] 8.1 In `RunBanner.tsx`, when `gateKind === 'clarify'`, the banner now shows:
  - The violet `?` icon (matching the design).
  - Title: "main agent is asking N questions to scope the feature" (where N comes from the question count).
  - Subtitle: "Phase 1a · clarify scope · X of N answered · est ~Y min remaining" (X from InterviewPane state — this may need to be lifted or communicated via a shared ref).
  - A "Skip all → defaults" ghost button that calls the skip handler.

- [x] 8.2 For the progress display in the banner, accept new props: `questionCount?: number`, `answeredCount?: number`. The ActiveRun parent can pass these down from the interview state.

## 9. UI: delete ClarifyComposer

- [x] 9.1 Delete `ui/src/components/ClarifyComposer/ClarifyComposer.tsx`.
- [x] 9.2 Delete `ui/src/components/ClarifyComposer/ClarifyComposer.css`.
- [x] 9.3 Delete `ui/src/components/ClarifyComposer/ClarifyComposer.test.tsx`.
- [x] 9.4 Remove all imports of `ClarifyComposer` from other files. Verify: `grep -r "ClarifyComposer" ui/src` returns zero hits.

## 10. UI: keyboard handling

- [x] 10.1 In `InterviewPane`, add keyboard listeners:
  - `Cmd/Ctrl + Enter`: submits current answer and advances (or finishes if last).
  - `Enter` on a focused option card: selects it.
  - `Escape`: deselects current option.
- [x] 10.2 Show keyboard hints in the action bar: `⌘ ↵ to submit` (matching the design).

## 11. Tests

- [x] 11.1 Create `ui/src/components/InterviewPane/InterviewPane.test.tsx`:
  - Renders with 1 plain string question → shows as active card with text input only (no radio options).
  - Renders with 3 structured questions → shows first as active, others not visible.
  - Selecting an option highlights it, clicking "Next" advances to question 2, question 1 appears as bubble pair above.
  - Clicking a previous answer bubble navigates back, previous selection is pre-filled.
  - Changing a previous answer and advancing preserves the new answer.
  - "Finish interview" on last question calls `api.resolveGate` with structured answers.
  - "Skip" calls `api.resolveGate` with `{ skipped: true }`.
  - Backward compat: all plain string questions → resolves with `{ answers: string[] }`.
- [x] 11.2 Create or update tests for `ProgressRail`:
  - Shows correct checkmarks, current highlight, and pending states.
  - Clicking an entry fires `onNavigate`.
- [x] 11.3 Update `ActiveRun` tests (if they exist) to cover the pane swap behavior.

## 12. Build and validate

- [x] 12.1 `npm run build -w protocol -w server -w ui` — all workspaces compile.
- [x] 12.2 `npm test -w protocol -w server -w ui` — all tests pass.
- [ ] 12.3 Manual: start the dev server, trigger a clarify gate, confirm:
  - Middle pane switches to conversation thread.
  - Right pane shows progress rail.
  - Structured options render as radio cards (if provided).
  - Navigation forward/backward works, answers persist.
  - Finishing the interview resolves the gate and reverts panes.
  - Plain string questions (backward compat) render as text-only cards.
  - ReviewGate (spec+plan) is unaffected.
