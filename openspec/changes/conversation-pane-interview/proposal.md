## Why

The current `ClarifyComposer` — shipped by the `inline-clarify-composer` change — renders clarification questions as a flat form pinned below the live stream: question labels with bare text inputs. It works, but:

1. **No structured options.** The agent knows the likely answers (it analysed the codebase, found existing patterns, loaded rules) but can only ask open-ended text questions. The user has to type "at-least-once" from memory instead of picking it from a curated list with context about each choice.

2. **No conversational history.** All questions are dumped at once as a stacked form. There's no sense of sequence, no record of what you already decided, no momentum through the interview.

3. **No "why am I being asked this?"** The agent has reasoning behind every question — e.g. "existing platform retry uses fixed 30s ticks, backoff would diverge from default" — but the current UI has no place to surface it.

4. **No navigation.** Questions are all-or-nothing; you can't go back and change an earlier answer after new context from a later question changes your mind.

Design reference: `Interview Designs.html` Variant A (Conversation pane) from the Bosch workflow design explorations.

## What Changes

The ClarifyComposer is replaced with a **Conversation Pane** experience that takes over the middle and right panes during an active clarify gate. The design follows Option A from the interview surfaces exploration.

### Protocol layer (`@bosch-sdlc/protocol`)

- **`ClarifyRequestSchema`** is extended. Each question becomes a structured object:
  ```
  { text: string, group?: string, why?: string, options?: Array<{ label: string, description?: string }> }
  ```
  The existing flat `questions: string[]` shape is accepted as a backward-compatible shorthand (each string is treated as `{ text: string }` with no group/why/options).

- **`ClarifyPayload`** type updated to match the new schema.

- **`ClarifyResolution`** is extended. `answers` becomes an array of `{ selected?: number, note?: string }` objects instead of bare strings. Backward compat: a flat `string[]` is still accepted server-side.

### Server (`server/src/gate/`)

- **`mcp-server.ts`** — the `clarify_request` MCP tool's Zod schema is updated to accept the new structured question shape.
- **`routes.ts`** — the `ClarifyAnswersBodySchema` is updated to accept the new answer shape alongside the legacy `string[]`.

### UI (`ui/src/`)

- **New `InterviewPane` component** replaces `ClarifyComposer`. Renders in the middle pane (replacing the stream) and a progress rail in the right pane (replacing telemetry) while a clarify gate is open.

  - **Conversation thread** in the middle pane: each answered question is a pair of bubbles (agent question bubble, user answer bubble). The current question is a violet-glowing card with:
    - The question text (large, prominent)
    - A "why" callout (italic, muted) if provided
    - Radio-style structured options if provided
    - An optional note text input
    - Submit, Skip, and navigation buttons
  - **One at a time**: only the current question is interactive. Previous answers appear as collapsed bubble pairs above. The user can click any previous answer or use Previous/Next buttons to navigate — going back re-opens that question with the previous selection pre-filled so it can be changed.
  - **Progress rail** in the right pane: numbered list of all questions with group labels, checkmarks for answered ones, current question highlighted. Below: "Next steps" showing what happens after the interview.

- **`ActiveRun.tsx`** — when a clarify gate is open, the middle pane switches from the stream to `InterviewPane`, and the right pane switches from telemetry to the progress rail. When the gate resolves, both panes revert.

- **`RunBanner.tsx`** — updated to show question count and progress (e.g. "3 of 6 answered").

- **`ClarifyComposer/`** — the existing component and its CSS are replaced by `InterviewPane`. The component directory is deleted.

### Keyboard

- `Cmd/Ctrl + Enter` submits the current answer.
- Arrow keys or Previous/Next buttons navigate between questions.
- `Enter` on a radio option selects it and auto-advances if it's the only required input.

### What does NOT change

- **`ReviewGate`** — the spec+plan approval page is untouched. This change is only about interview prompts.
- **`gate_request` MCP tool** — the generic gate mechanism stays the same.
- **DB schema** — no migration needed; payloads are JSON blobs.
- **WebSocket events** — `gate-request` and `gate-resolved` event shapes stay the same (the payload is already `GatePayload` which is `Record<string, unknown>`).

## Capabilities

### New Capabilities

- `structured-interview`: The clarify gate renders as a conversational, navigable interview with structured options, contextual "why" callouts, and a progress rail.

### Modified Capabilities

- `web-ui`: `Active Run page renders an inline ClarifyComposer` is REMOVED. Replaced by `Active Run page renders an InterviewPane conversation when a clarify gate is open, with a progress rail replacing the telemetry pane`.
- `gate-bridge`: `ClarifyRequestSchema accepts questions: string[]` is MODIFIED to also accept the structured question shape.

## Impact

- **Code deleted.**
  - `ui/src/components/ClarifyComposer/ClarifyComposer.tsx`, `.css`, `.test.tsx` — replaced by InterviewPane.

- **Code added.**
  - `ui/src/components/InterviewPane/InterviewPane.tsx` — conversation thread with one-at-a-time navigation, structured options, violet active card. ~350 LoC.
  - `ui/src/components/InterviewPane/InterviewPane.css` — conversation bubbles, active card glow, radio options, progress rail. ~200 LoC.
  - `ui/src/components/InterviewPane/ProgressRail.tsx` — right-pane progress display. ~80 LoC.
  - `ui/src/components/InterviewPane/InterviewPane.test.tsx` — navigation, option selection, note entry, submit, skip, back-navigation answer editing. ~200 LoC.

- **Code edited.**
  - `protocol/src/mcp-schemas.ts` — `ClarifyRequestSchema` extended.
  - `protocol/src/types.ts` — `ClarifyPayload`, `ClarifyResolution` types updated.
  - `server/src/gate/mcp-server.ts` — updated Zod schema for `clarify_request`.
  - `server/src/gate/routes.ts` — updated `ClarifyAnswersBodySchema`.
  - `ui/src/components/ActiveRun/ActiveRun.tsx` — conditional pane swap during clarify gate.
  - `ui/src/components/RunBanner/RunBanner.tsx` — progress count in banner.

- **Tests.**
  - New `InterviewPane.test.tsx`.
  - Deleted `ClarifyComposer.test.tsx`.
  - Updated `server/src/gate/__tests__/clarify-request.test.ts` for new schema.
  - Updated `ui/src/components/ClarifyComposer/ClarifyComposer.test.tsx` deletion.

- **Out of scope.**
  - Adapting the SKILL template to send structured questions. That's a follow-up: agents currently send `questions: string[]` and will continue to work via backward compat. When structured options are added to the SKILL guidance, the richer UI activates automatically.
  - Persisting in-progress answers across page reloads.
  - Animations/transitions between stream and interview pane.
