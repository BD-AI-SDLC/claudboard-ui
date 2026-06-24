## Why

The Kickoff ("Start a feature") page renders a panel titled "Recent in this repo" below the submit row. The panel is populated from a hardcoded module-level constant in `ui/src/components/Kickoff/Kickoff.tsx:30-34`:

```ts
const RECENT_RUNS = [
  { ticket: 'MEAS-7128', name: 'Tenant-scoped audit log endpoint',   status: 'merged', ago: 'yesterday' },
  { ticket: 'MEAS-7102', name: 'Add PaymentMethodDto v2',            status: 'merged', ago: '3d' },
  { ticket: 'MEAS-7081', name: 'Migrate scheduler off Quartz',       status: 'merged', ago: '6d' },
]
```

These are not real runs. They are not fetched from the server, they are not filtered by the open repo, they never change. Every user on every repo sees the same three `MEAS-*` tickets with the same relative times. The panel is a high-fidelity lie sitting underneath a form that otherwise renders truthfully.

This is the same class of problem that the recently-merged `kickoff-shows-real-project-key` change addressed for the branch preview's project-key segment — and that change explicitly noted `RECENT_RUNS` as deferred:

> The fake `RECENT_RUNS` array (Kickoff.tsx lines 30-34) is left untouched. It is a separate dead-scaffolding problem and warrants its own change.

This is that follow-up change.

The remediation is straight deletion, not replacement. A real "Recent in this repo" panel would be useful UX but is a meaningfully larger piece of work (decisions about ranking, derive-title-from-prompt, ticket display when the run hasn't reached the spec+plan gate, click-through navigation, etc.). Bundling that scope into a cleanup change would dilute both. The endpoint to back a real panel (`GET /api/runs?projectId=`) already exists if and when a follow-up change wants to take that on.

## What Changes

### UI (`ui/src/components/Kickoff/Kickoff.tsx`)

- Delete the module-level `RECENT_RUNS` constant (lines 30-34).
- Delete the JSX block that renders the panel (lines 214-230), including its outer wrapper `<div style={{ marginTop: '28px' }}>`.
- Audit imports after the deletion. `Icon` and `StatusChip` are still used elsewhere in the file (the submit button's rocket icon, run-state chips). Confirm before removing either import — only remove if no remaining reference exists.

### UI (`ui/src/components/Kickoff/Kickoff.css`)

- Delete the CSS classes consumed exclusively by the removed JSX block (lines ~190-240):
  - `.kickoff__recent-title`
  - `.kickoff__recent-card`
  - `.kickoff__recent-row`
  - `.kickoff__ticket-chip`
  - `.kickoff__recent-name`
  - `.kickoff__recent-ago`
- Verify via `grep` that no other component file references any of these class names before deleting. The CSS prefix lint (`ui/scripts/check-css-prefixes.js`) enforces co-location, so leaks across files are unlikely but worth a one-shot grep to confirm.

### Tests

- Existing Kickoff tests do not assert on the recent-runs panel (the panel was never exercised by tests). No test removal is required.
- If a new test is added at all, it is a smoke assertion that the rendered Kickoff has no element with text matching `/Recent in this repo/i` and no element with class `kickoff__recent-*`. This guards against accidental revert via cherry-pick or merge.

### No spec change

The live `openspec/specs/web-ui/spec.md` describes the Kickoff screen's responsibilities (prompt entry, autonomy selection, submit shape, topology-invariant layout) but does NOT describe a recent-runs panel. There is no requirement to **REMOVE**, **MODIFY**, or **ADD**. This change directory therefore has no `specs/` subdirectory — by design, not by omission.

### Out of scope

- Adding a real recent-runs panel. The data layer exists (`GET /api/runs?projectId=`, already returns `Run[]` ordered by `created_at DESC` and is already consumed by `App.tsx`, `useActiveRuns`, and tests). The UX design — what to render for "title" when `Run` carries only `prompt`, whether to show tickets when the ticket only materialises mid-run inside `SpecPlanGatePayload.ticket`, how many rows to show, click behaviour — is its own conversation and its own change.
- Any change to the Dashboard's "Recent runs" panel. That is a different component, backed by real data, in a different file.
- Removing `Icon` or `StatusChip` imports. They are used elsewhere in `Kickoff.tsx`; the deletion stays scoped to what the panel itself owns.
