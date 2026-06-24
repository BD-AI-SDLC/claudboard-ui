## Context

The Pause button in the Active Run page's Stream pane is the most visible interactive control on the screen during a long run. Today it renders fully styled but has no handler:

```tsx
// ui/src/components/ActiveRun/ActiveRun.tsx:399-404
<div className="active-run__pane-head-actions">
  <button className="active-run__btn-ghost">
    <Icon name="pause" size={11} />
    Pause
  </button>
</div>
```

Every prerequisite for making it work is already in place: the REST endpoints (`run/routes.ts:125-148`), the driver-level deferred plumbing (`run/driver.ts:13-37`), the API-client methods (`api/client.ts:50-51`), the `paused-user` status enum value, and the `StatusChip` rendering for that status (`primitives/StatusChip.tsx:25`). The pause-resume capability spec (`openspec/specs/pause-resume/spec.md`) is authoritative on the backend behaviour. This change has nothing to add to that capability — it has only to wire the UI.

The current `status` value in `ActiveRun.tsx:246` comes from the WebSocket-fed `run?.status` and is updated in real time by the `status-change` event. That gives us a free source-of-truth signal: we don't need to manage button state locally beyond the in-flight POST flag.

## Goals / Non-Goals

**Goals:**
- The Pause button is a working control: clicking it pauses a running run and resuming a paused run flips it back.
- The button's label and icon reflect the next action (Pause when running, Resume when paused-user).
- The button is visibly disabled (not just inert) when the action isn't available for the current status.
- Double-clicks during the in-flight POST do not produce double requests.
- POST failure surfaces to the user as a transient inline error.

**Non-Goals:**
- Pause from `paused-gate` (the gate banner owns that flow; the button stays disabled).
- Keyboard shortcut for pause/resume.
- A separate kill / cancel control. (Suspend is the upcoming follow-up.)
- Restyling the Stream-pane action area beyond what disabled state requires.
- Surfacing the pause control anywhere other than the Stream pane header.

## Decisions

### D1. Source of truth for button state is `run.status`, not local state

**Choice:** The button's label, icon, and `disabled` attribute are derived in render from `status` (the same value already in scope at `ActiveRun.tsx:246`). The component does NOT keep a local `isPaused` boolean.

**Why:** The status is already kept fresh by the WebSocket `status-change` event flowing through `useRunStream`. Any local mirror would either lag or drift on reconnect. The single in-flight `pending` flag we DO need is purely about HTTP request lifecycle — it clears on response or on next `status-change`, whichever comes first.

### D2. Disabled, not hidden, for non-pausable statuses

**Choice:** When `status` is `paused-gate`, `done`, `failed`, or `dead`, the button renders with `disabled` + a visual greyed-out class. It does NOT disappear.

**Why:** Layout stability — the user shouldn't see the action area shift size as the run progresses. Discoverability — a user who never saw the working button doesn't learn the feature exists. Affordance — the disabled state communicates "this exists but isn't applicable now," which is the truth.

**Why not for `paused-gate`:** The pause-resume spec asserts that pausing during a gate is rejected (HTTP 409). The gate banner already drives the gate-resolution UX. A second control with overlapping semantics would confuse users.

### D3. In-flight flag, not a state machine

**Choice:** A single boolean `pending: boolean` in component state, set true on click and cleared on response (success or error) AND on the next `status-change` WS event for this run.

**Why:** The interaction is a single request with a single visible outcome. A state machine (`idle | pending | error`) is overkill — the error display is a separate transient string that lives or expires on its own timer. Clearing `pending` on `status-change` covers the case where the server processes the request but the response is slow: as soon as the WS event arrives, the button is responsive again.

### D4. Inline error message, no toast

**Choice:** On POST rejection, render a one-line error message immediately under the button for 4 seconds, then clear. Use the existing error styling vocabulary (no new toast component).

**Why:** There is no toast/notification system in the app today. Introducing one for a single button's error path is over-scoped. An inline message is local, requires no new infrastructure, and is the standard pattern used elsewhere (e.g. the kickoff banner work in `fix/kickoff-error-banner`).

### D5. Test surface mirrors the spec scenarios

**Choice:** A single new test file `pause-button.test.tsx` colocated with `ActiveRun.tsx`, covering the four scenarios in the spec delta exactly. No new test infrastructure; reuse the existing Vitest + RTL + `vi.mock('../../api/client.js')` pattern from sibling tests.

**Why:** The existing `pipeline.test.ts` and `stream.test.ts` are scenario-organised by spec requirement. Following the same pattern keeps the test suite navigable and gives future readers a 1:1 mapping from a scenario in the spec to a test case.

## Risks / Trade-offs

- **Risk:** The WebSocket `status-change` event may lag the HTTP response on a busy server, leading to a brief window where the button is enabled with the old label. **Mitigation:** Render the new label optimistically from `pending` + intent — i.e., when the user clicks Pause and the response arrives but the WS event hasn't, show "Resume" (the intended next action). The next `status-change` confirms it; if the server rejected (409), the error message surfaces and the label reverts.

- **Risk:** A WebSocket reconnection drops events the client missed, leaving the button label out of sync. **Mitigation:** Out of scope here — `useRunStream` already handles reconnection by re-fetching the latest run state via `GET /api/runs/:id`. The button picks up the correct status on the next render.

- **Trade-off:** No keyboard shortcut. **Justification:** Keyboard shortcuts require a global key-handler infrastructure that doesn't exist. Deferred to a focused affordance change.

## Migration Plan

No migration. This is a UI-only change with no protocol, server, or schema impact. Existing users see the same button gain a working `onClick` handler. The pause/resume REST endpoints have been live for previous releases; the change is the addition of a UI consumer.

## Open Questions

None. All open design questions were resolved in the exploration session that produced this change:
- Bundle with `add-run-suspend` or ship separately? — **Separately.** This change ships first.
- Disabled-state vs hidden? — **Disabled** (D2).
- Optimistic label vs wait for WS? — **Optimistic** (D1 + Risks).
