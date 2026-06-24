## Why

The Review Gate currently uses a 50/50 split — spec files (tabbed) on the left, the single plan file on the right. This forces users onto a wide screen to read either side comfortably and visually implies a side-by-side comparison that doesn't exist (the plan is a synthesis of the specs, not a diff against them). Reusing the existing tab pattern for both specs and plan collapses the screen into a single full-width panel, makes the artifacts read sequentially instead of competing for attention, and removes the wide-screen requirement.

## What Changes

- Collapse the Review Gate's two-column grid into a **single full-width content panel** beneath the action bar.
- Render a **single tab row** containing both spec files and the plan file, organized as two labeled groups:
  - `SPECS:` group — one tab per spec file (existing behavior).
  - Vertical divider.
  - `PLAN:` group — one tab for the single plan file, labeled with its filename (e.g. `plan.md`).
- **Default active tab** remains the first spec (preserves current behavior).
- **Active panel renderer** switches based on tab type: Gherkin syntax-highlight for spec tabs, ReactMarkdown for the plan tab. Both renderers already exist; only the layout consolidates.
- **Drift indicator** — keep the existing in-panel drift banner; **add a small dot/badge on any inactive tab whose file has drifted**, so drift on a non-active spec is not hidden behind a tab switch.
- Content width stretches to the container with no max-width cap.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `web-ui`: The Review Gate screen's layout requirement changes from "spec + plan side-by-side" to a single full-width panel with a unified tab row spanning both specs and the plan. The drift-visibility behavior also gains a per-tab indicator.

## Impact

- **Affected code:**
  - `ui/src/components/ReviewGate/ReviewGate.tsx` — merge `specMeta` and `planMeta` into a single tab list; render one content panel; switch renderer based on the active tab's kind; add drift dot to inactive tabs.
  - `ui/src/components/ReviewGate/ReviewGate.css` — remove the `.review-gate__split` grid; add group-label, divider, and drift-dot styles.
- **No protocol changes.** `SpecPlanGateEventPayload` and `SpecPlanGateSnapshot` already carry everything needed (`specFiles: GateFileSnapshot[]` and `plan: GateFileSnapshot | null`).
- **No server changes.** Per-file refresh endpoint (`/api/gates/:gateId/files/:index`) is unchanged.
- **No API or behavior changes** for approve / request-changes actions, gate routing in `App.tsx`, or the `RunBanner` CTA — only the Review Gate page's internal layout changes.
