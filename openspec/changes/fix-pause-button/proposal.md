## Why

The Active Run page's Stream pane renders a Pause button (`ui/src/components/ActiveRun/ActiveRun.tsx:400-403`) that has no `onClick` handler — clicking it does nothing. The entire backend mechanism it should drive is already shipped and tested: `POST /api/runs/:id/pause` and `POST /api/runs/:id/resume` are wired through `run/routes.ts:125-148`, backed by the `setPausedUser` / `resumeRun` deferred-promise plumbing in `run/driver.ts:13-37`, and covered by `server/src/run/__tests__/pause-resume.test.ts` and integration test 13.2. The protocol surfaces `pauseRun` and `resumeRun` on the API client (`ui/src/api/client.ts:50-51`). The `paused-user` status is even rendered correctly by `StatusChip` (`primitives/StatusChip.tsx:25`).

Only the button is dead. A user who wants to pause a runaway agent has to call the REST endpoint via `curl` or wait it out. The visible-but-dead button is also actively misleading — users assume their click did something and watch the agent keep running, unsure whether the message is queued or the feature is broken.

This change wires the existing button to the existing endpoints and adds a corresponding Resume affordance when the run is in `paused-user`. It is a pure UI fix: no protocol change, no server change, no DB change, no spec for behaviour the system doesn't already implement.

It is also a deliberate prerequisite for the upcoming `add-run-suspend` change, which will add a separate Suspend button next to the (now-working) Pause button. Shipping the pause fix first keeps the suspend work focused on suspend semantics rather than carrying UI debt.

## What Changes

- Wire `onClick` on the Stream-pane button at `ui/src/components/ActiveRun/ActiveRun.tsx:400-403` to call `api.pauseRun(runId)` when `status === 'running'`, or `api.resumeRun(runId)` when `status === 'paused-user'`.
- Toggle the button label and icon based on status: `Pause` + `pause` icon when running, `Resume` + `play` icon when `paused-user`.
- Disable the button (`disabled` attribute + visual `disabled` class) when `status` is anything other than `running` or `paused-user`. Specifically: hidden actions block during `paused-gate` (the gate banner already drives that interaction), greyed out for terminal states (`done`, `failed`, `dead`).
- Hold a transient in-flight flag in the component while the POST is outstanding so a double-click cannot fire two requests. The flag clears on response or on the next `status-change` WS event, whichever comes first.
- On network failure (POST rejects), surface a one-line error under the button for 4 seconds, then clear it. Do not flip the button label on error — the WS `status-change` event remains the source of truth for status.
- Add a `play` icon to `ui/src/components/primitives/Icon.tsx` if one is not already present. (`Icon.tsx:31` defines `pause`; verify the icon set before adding.)
- Add Vitest coverage in a new `ui/src/components/ActiveRun/pause-button.test.tsx` that mounts `ActiveRun` with a mocked `api` and `useRunStream`, asserts the button calls the right endpoint per status, asserts the disabled/hidden behaviour for non-pausable statuses, asserts double-click coalescing, and asserts the error-message branch.

## Capabilities

### Modified Capabilities

- `web-ui`: the Active Run page surfaces an interactive Pause/Resume control wired to the existing pause/resume REST endpoints, with explicit disabled state for non-pausable statuses and double-click protection.

### New Capabilities

None.

## Impact

- **Protocol (`protocol/src/`):** no change. `pauseRun` / `resumeRun` already exist on the API client; the `paused-user` status is already in `RUN_STATUS_VALUES`.
- **Server (`server/src/`):** no change. The pause and resume endpoints, the deferred plumbing, the status invariants, and the broadcast events are already in place.
- **Database:** no change. No new columns; no migration.
- **UI (`ui/src/`):**
  - `components/ActiveRun/ActiveRun.tsx` — wire the existing button, add the inverse Resume affordance, derive disabled state from status, hold an in-flight flag.
  - `components/ActiveRun/ActiveRun.css` — add `.active-run__btn-ghost--disabled` and `.active-run__btn-error` rules if the existing button styling doesn't already cover them. (Verify during implementation.)
  - `components/primitives/Icon.tsx` — add a `play` icon entry if not already present.
  - `components/ActiveRun/pause-button.test.tsx` — NEW. Covers the four interaction scenarios in the spec delta.
- **Filesystem:** no new on-disk artifacts.
- **No breaking changes** — the Pause button has no working behaviour today; users who happened to click it observe a transition from "no-op" to "actually pauses." No existing UI consumer depends on the button being non-functional.
- **Out of scope (explicitly deferred):**
  - The Suspend button, the `suspended` run status, SDK session capture, MCP gate idempotency, and the cold-resume path — all owned by `add-run-suspend`.
  - Any restyling of the Stream-pane action area beyond the minimum needed to render the disabled state — left for a future visual-polish change.
  - Keyboard shortcuts for pause/resume — left for a future affordance change.
