## 1. UI: wire the existing Pause button

- [x] 1.1 In `ui/src/components/ActiveRun/ActiveRun.tsx`, locate the button at lines 400-403 (under the `.active-run__pane-head-actions` div). Replace the inert markup with a component-local `<PauseResumeButton status={status} runId={runId} />` (or, if introducing a child component feels heavy for ~40 LOC, inline the logic — the choice is purely local-readability, no behaviour difference).
- [x] 1.2 The render expression for the button:
  - Compute `nextAction: 'pause' | 'resume' | null` from `status`: `'running' → 'pause'`, `'paused-user' → 'resume'`, anything else → `null`.
  - When `nextAction === null`, render the button with `disabled` and the `active-run__btn-ghost--disabled` class; label `Pause`, icon `pause` (the visual neutral state). Do NOT hide the button.
  - When `nextAction === 'pause'`, label `Pause`, icon `pause`, `onClick = handlePause`.
  - When `nextAction === 'resume'`, label `Resume`, icon `play`, `onClick = handleResume`.
- [x] 1.3 Add component-local state `const [pending, setPending] = useState(false)` and `const [errorMsg, setErrorMsg] = useState<string | null>(null)`. Disable the button while `pending === true` (in addition to the status-derived disabled state).
- [x] 1.4 Implement `handlePause` and `handleResume`:
  ```ts
  async function handlePause() {
    if (pending) return
    setPending(true)
    setErrorMsg(null)
    try {
      await api.pauseRun(runId)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to pause')
      setPending(false)
    }
  }
  ```
  Mirror for `handleResume` using `api.resumeRun`. (Do NOT clear `pending` on success — that is cleared by the `status-change` listener, see 1.5.)
- [x] 1.5 Add a `useEffect` keyed on `status` that clears `pending` whenever `status` transitions to `running` or `paused-user`. This handles both the success path (WS event confirms the transition) and the case where the user manually triggers the inverse action mid-request.
- [x] 1.6 Add a `useEffect` keyed on `errorMsg` that clears `errorMsg` after 4 seconds via `setTimeout`. Clean up the timer on unmount and on `errorMsg` change.
- [x] 1.7 Render `errorMsg` under the button when non-null. Use a `<div className="active-run__btn-error">{errorMsg}</div>` element. Inline-style for now if no CSS rule covers the look (the design says: error-coloured, 12px, single line, no break).

## 2. UI: icon

- [x] 2.1 Open `ui/src/components/primitives/Icon.tsx`. Confirm whether a `play` icon exists. If absent, add one — a single right-pointing triangle. The existing `pause` icon at `Icon.tsx:31` is the style reference (16x16 viewBox, currentColor fill).
- [x] 2.2 If `play` already exists, skip 2.1. Either way, verify the new render-tree compiles (`tsc --noEmit` in `ui/`).

## 3. UI: CSS

- [x] 3.1 In `ui/src/components/ActiveRun/ActiveRun.css`, find the `.active-run__btn-ghost` rule. Add a `.active-run__btn-ghost--disabled` sibling (or a `&:disabled` pseudo-selector style — match the file's existing pattern by inspection) that reduces opacity, sets `cursor: not-allowed`, and disables the hover background. Use the existing `--muted` token for the foreground.
- [x] 3.2 Add a `.active-run__btn-error` rule: small font (`12px`), red foreground (`var(--red)` or whichever red token the failed status chip uses), single line, top margin matching the button's bottom edge.
- [x] 3.3 Run `ui/scripts/check-css-prefixes.js` (via `npm run lint` in `ui/`) to confirm no class-name violations.

## 4. UI: tests

- [x] 4.1 Create `ui/src/components/ActiveRun/pause-button.test.tsx`. Use the same mocking pattern as `pipeline.test.ts` / `stream.test.ts` (which already mock `useRunStream` and `api`).
- [x] 4.2 Add test case **"calls pauseRun when status is running and button is clicked"**: render `ActiveRun` with `status: 'running'`, click the Pause button (find by accessible name "Pause"), assert `api.pauseRun` was called with the run id exactly once.
- [x] 4.3 Add test case **"calls resumeRun when status is paused-user and button is clicked"**: render with `status: 'paused-user'`, click the button (now labelled "Resume"), assert `api.resumeRun` was called once.
- [x] 4.4 Add test case **"button is disabled when status is paused-gate, done, failed, or dead"**: parameterise over those four statuses. Render, assert the button is present, has the `disabled` attribute, has the `--disabled` class, and that clicking it does NOT call `api.pauseRun` or `api.resumeRun`.
- [x] 4.5 Add test case **"double-click while in-flight only fires one request"**: mock `api.pauseRun` with a never-resolving promise (or a promise that resolves after a tick). Click twice rapidly. Assert `api.pauseRun` was called exactly once.
- [x] 4.6 Add test case **"POST failure surfaces an inline error for 4 seconds, then clears"**: mock `api.pauseRun` to reject with `new Error('boom')`. Render, click, await the assertion: error text "boom" is visible. Use `vi.useFakeTimers()` to advance 4000ms. Assert the error text is gone.
- [x] 4.7 Add test case **"status-change WS event clears the pending flag"**: mock `api.pauseRun` with a slow promise. Click. Simulate a `status-change` event flipping `status` from `running` to `paused-user` (re-render with the new status prop). Assert the button is now labelled "Resume" and is enabled (no longer disabled by the pending flag).

## 5. Verify end-to-end

- [x] 5.1 Run `npm run build` from the repo root. Confirm clean build through all three workspaces.
- [x] 5.2 Run `npm run typecheck` and `npm run lint` from the repo root. Both must pass.
- [x] 5.3 Run `npx vitest run ui/src/components/ActiveRun/pause-button.test.tsx` from `ui/`. All cases in section 4 must pass.
- [x] 5.4 Run `npx vitest run` from `ui/` to confirm no regression in sibling tests (`pipeline.test.ts`, `stream.test.ts`).
- [x] 5.5 Run `node --experimental-vm-modules ../node_modules/.bin/jest` from `server/`. Server tests are unaffected but should still pass.
- [ ] 5.6 Manual smoke: `npm run dev` from `server/` and `ui/`, create a long-running test run, click Pause, observe status pill → `paused-user`, click Resume, observe pill → `running`. Confirm WS events arrive and the button label tracks. *(deferred — requires user to exercise the dev server)*
