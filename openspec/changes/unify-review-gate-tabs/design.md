## Context

`ReviewGate.tsx` today renders a CSS grid (`.review-gate__split { grid-template-columns: 1fr 1fr }`) with two columns. The left column has its own tab row over `specMeta: PanelMeta[]`; the right column renders a single `planMeta: PanelMeta | null` with no tab. Each column also has a header (`.review-gate__col-head`) showing artifact title + author attribution + a filename chip, and each has its own provenance row + drift banner + content area.

Both `PanelMeta` instances share the same shape (`{ snapshot, live, view }`), and both columns share the same provenance / drift / refresh affordances. The only meaningful difference between the two columns is the content renderer: specs are highlighted Gherkin, the plan is ReactMarkdown.

`specFiles: GateFileSnapshot[]` and `plan: GateFileSnapshot | null` arrive in the props from `App.tsx`, sourced from the `SpecPlanGateEventPayload.snapshot`. The protocol shape is not changing.

## Goals / Non-Goals

**Goals:**
- One full-width content panel in place of the two-column grid.
- A single tab row spanning specs and the plan, organized as two labeled groups (`SPECS:` … `┃` … `PLAN:`).
- Per-tab drift indicator (dot/badge) on inactive tabs whose underlying file has drifted, so drift on a non-active spec is not hidden.
- Preserve all existing behavior: approve / request-changes flow, per-file refresh, snapshot ↔ live toggle, drift banner inside the active panel, refresh-error surfacing.

**Non-Goals:**
- No protocol or server changes. The same `SpecPlanGateEventPayload` and `/api/gates/:gateId/files/:index` endpoint are reused.
- No change to the approve / request-changes UX, top-bar, head card, or routing.
- No change to the renderers themselves — only when each renderer fires (driven by the active tab's kind).
- No change to the `App.tsx` gate-routing logic.

## Decisions

### Unified tab model

Introduce a small discriminated union in `ReviewGate.tsx` to represent a single entry in the merged tab list:

```ts
type TabEntry =
  | { kind: 'spec'; index: number; meta: PanelMeta }
  | { kind: 'plan'; meta: PanelMeta }
```

Derive `tabs: TabEntry[]` as `[...specMeta.map((meta, index) => ({ kind: 'spec', index, meta })), ...(planMeta ? [{ kind: 'plan', meta: planMeta }] : [])]`. A single `activeTab: number` indexes into this list. The first spec sits at index `0`, preserving the current default.

**Alternatives considered:** keeping two separate `activeTab` slots (one per group) and only rendering one panel based on the most-recently-clicked group. Rejected — adds state for no behavioral gain; one cursor over a flat list is simpler.

### Layout: labels and divider in the tab row (Option C1)

The existing `.review-gate__tabs` row stays, but its children change:

```
┌──────────────────────────────────────────────────────────────────┐
│ SPECS:  spec-A │ spec-B │ spec-C  ┃  PLAN:  plan.md              │
└──────────────────────────────────────────────────────────────────┘
```

- Add a non-clickable `.review-gate__tab-group-label` span at the start of each group (`SPECS:`, `PLAN:`).
- Add a `.review-gate__tab-divider` element between the two groups (vertical rule, 1px, ~20px tall, `var(--border)`).
- If `planMeta` is null, render only the SPECS group with no divider. If `specMeta` is empty (edge case — shouldn't happen in practice), render only PLAN with no divider.
- Tabs themselves keep their existing `.review-gate__tab` / `.review-gate__tab--active` styling. The label and divider sit inline alongside the tab buttons.

**Alternatives considered:** C2 (groups hug opposite edges) and C3 (group headers on a separate row above). C2 looks awkward with imbalanced group sizes; C3 costs vertical space and adds visual weight. Settled on C1 in the explore session.

### Drop the per-column heads; surface attribution inline (if at all)

The current `.review-gate__col-head` blocks ("BDD specification by sdd-expert-agent · N files" and "Execution plan by architect-agent") cannot survive into a single-panel layout in their current form. Two sub-decisions:

1. **Remove `.review-gate__col-head` entirely.** With the tab row's `SPECS:` / `PLAN:` labels carrying the artifact-type signal, the column heads are redundant.
2. **Attribution** ("by sdd-expert-agent" / "by architect-agent") and **file-count** ("· N files") are quiet nice-to-haves the user did not ask to preserve. The simplest path is to drop them. If we want to keep authorship visible, the cheapest carrier is a small muted suffix next to the group label, e.g. `SPECS · sdd-expert-agent`. Default decision: **drop them** to keep the row clean; revisit only if it turns out the attribution is load-bearing.

The per-file `.review-gate__provenance` row (path · size · mtime · refresh) stays exactly as it is, just rendered once below the unified tab row for the active file. Same for the `.review-gate__drift` banner.

### Drift dot on inactive tabs

A file is drifted when `meta.live?.drifted === true`. Drift is only known after the user has clicked refresh on that file (it's the live response that carries the `drifted` flag). So:

- Compute `tabHasDrift(meta: PanelMeta) => meta.live?.drifted === true`.
- For every tab, render a small `.review-gate__tab-drift-dot` element if `tabHasDrift(meta)` is true. The dot is visible on inactive tabs; it can also be visible on the active tab (harmless — the in-panel banner is the primary signal there).
- Color: `var(--amber)` to align with the existing drift banner background.
- Size: ~6px circle, positioned to the right of the tab label.

This does not change *when* drift is detected — it remains a side effect of the user's refresh action — only how it's surfaced.

### Content panel: single block, renderer switches on tab kind

Below the tab row and the provenance row, render exactly one of:

- `.review-gate__spec` (Gherkin-highlighted lines) when `activeEntry.kind === 'spec'`.
- `.review-gate__plan` (ReactMarkdown) when `activeEntry.kind === 'plan'`.

Both styles already exist and need no change. The container they sit in is the full panel width — no inner column wrapper, no grid. The CSS rule `.review-gate__split` is removed entirely; the outer flex column from `<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>` already provides the stretch behavior the user wants ("stretch to fit, no more than space allows").

### Provenance / drift / refresh wiring

The existing helpers stay:

- `refreshSpec(idx)` and `refreshPlan()` continue to write into `specMeta`/`planMeta` respectively. The active-tab dispatch picks the right one (`activeEntry.kind === 'spec' ? refreshSpec(activeEntry.index) : refreshPlan()`).
- `toggleSpecView(idx)` and `togglePlanView()` likewise. The drift banner's "Load current / Load snapshot" button calls the right one based on `activeEntry.kind`.
- `refreshing: string | null` keys stay as `spec:<idx>` and `plan` — no change.

## Risks / Trade-offs

- **Losing the column-head attribution** ("by sdd-expert-agent" / "by architect-agent" / "· N files"). → If anyone relies on this for orientation, we can add a muted suffix to the group labels in a follow-up. Cheap to add later, removing first keeps the row clean.
- **Tab row becomes wider** (specs + divider + plan + labels). On narrow viewports it could need horizontal scroll. → `.review-gate__tabs` already has `overflow-x: auto`; this continues to work. Per the user's "no max-width cap" preference, we don't introduce additional wrapping behavior.
- **Drift dot only appears after a refresh.** → Same as today's drift banner — drift detection has always been refresh-gated. Acceptable: the dot reflects the *current* knowledge of drift, not a server-pushed truth, which matches existing semantics.
- **Plan tab uses Markdown renderer; user might expect Gherkin highlighting on the plan tab by analogy.** → The renderer switch is keyed on tab `kind`, not on tab position, so this is deterministic and matches today's per-column behavior.

## Migration Plan

UI-only change. Deploy is a straight rebuild — no DB migration, no server restart sequencing.

Rollback: revert the two file changes (`ReviewGate.tsx`, `ReviewGate.css`). No data shape changes to undo.
