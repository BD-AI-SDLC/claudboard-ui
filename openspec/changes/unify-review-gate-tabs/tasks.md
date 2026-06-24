## 1. Refactor ReviewGate.tsx into a single-panel tab model

- [x] 1.1 Introduce a local `TabEntry` discriminated union (`{ kind: 'spec', index, meta } | { kind: 'plan', meta }`) and derive a flat `tabs: TabEntry[]` from `specMeta` and `planMeta`, with all spec tabs first followed by the plan tab (when present)
- [x] 1.2 Clamp `activeTab` against `tabs.length` (handles the empty-specs edge case where the plan becomes index 0) and keep the existing default of `useState(0)`
- [x] 1.3 Derive `activeEntry = tabs[activeTab]` and use it everywhere `activeSpec` / `planMeta` are currently consulted for rendering, dispatching to `refreshSpec(activeEntry.index)` vs `refreshPlan()` and `toggleSpecView(activeEntry.index)` vs `togglePlanView()` based on `activeEntry.kind`
- [x] 1.4 Render the content panel once below the provenance + drift rows, switching between `.review-gate__spec` (Gherkin lines) and `.review-gate__plan` (ReactMarkdown) on `activeEntry.kind`
- [x] 1.5 Remove both `.review-gate__col` blocks and the `.review-gate__split` wrapper; remove the per-column `.review-gate__col-head` markup entirely (attribution / file-count is dropped per design)

## 2. Update the tab row to render two labeled groups with a divider

- [x] 2.1 Inside `.review-gate__tabs`, render `<span className="review-gate__tab-group-label">SPECS:</span>` followed by the spec tab buttons when `specMeta.length > 0`
- [x] 2.2 Render `<span className="review-gate__tab-divider" aria-hidden="true" />` between the two groups only when both `specMeta.length > 0` and `planMeta` is non-null
- [x] 2.3 Render `<span className="review-gate__tab-group-label">PLAN:</span>` followed by a single tab button for the plan when `planMeta` is non-null
- [x] 2.4 Use a stable key for the plan tab (e.g. `plan:${planMeta.snapshot.path}`) distinct from spec keys
- [x] 2.5 Verify the plan tab's display label uses `basename(planMeta.snapshot.path)` for consistency with spec tabs

## 3. Add the drift indicator on inactive tabs

- [x] 3.1 Introduce a small helper `tabHasDrift(meta: PanelMeta) => meta.live?.drifted === true`
- [x] 3.2 In the tab button render, append `<span className="review-gate__tab-drift-dot" aria-hidden="true" />` when `tabHasDrift(entry.meta)` is true
- [x] 3.3 Confirm the dot appears on both inactive and active tabs (harmless on the active tab where the existing banner is the primary signal)

## 4. Update ReviewGate.css for the new layout

- [x] 4.1 Delete the `.review-gate__split` rule (the grid-template-columns: 1fr 1fr block)
- [x] 4.2 Delete `.review-gate__col`, `.review-gate__col:last-child`, `.review-gate__col-head`, `.review-gate__col-head-title`, `.review-gate__col-head-sub`, `.review-gate__col-head-actions` (no longer referenced)
- [x] 4.3 Add `.review-gate__tab-group-label` — small uppercase muted text inline with the tab buttons (font-family `var(--font-mono)`, font-size `var(--fs-xs)`, color `var(--muted)`, padding to align baseline with tabs)
- [x] 4.4 Add `.review-gate__tab-divider` — 1px wide vertical rule (~20px tall) with `background: var(--border)`, sized via margin to sit between the two groups
- [x] 4.5 Add `.review-gate__tab-drift-dot` — ~6px circle (`width: 6px; height: 6px; border-radius: 50%; background: var(--amber)`), inline next to the tab label with a small left margin
- [x] 4.6 Verify the tab row continues to `overflow-x: auto` so labels + tabs + divider can scroll horizontally on narrow viewports

## 5. Verify and ship

- [x] 5.1 Run `npm run typecheck -w ui` and resolve any type errors
- [x] 5.2 Run `npm run lint -w ui` (includes the CSS prefix check — confirm all new classes are `review-gate__`-prefixed)
- [x] 5.3 Run `npm run test -w ui` — update or add `ReviewGate.test.tsx` cases for: default-active = first spec; plan tab is appended after specs; renderer swaps on tab change; drift dot renders when `live.drifted === true`; plan-only payload renders no SPECS label or divider
- [x] 5.4 Run `npm run build -w ui` to confirm the production build is clean
- [ ] 5.5 Use the `verify` skill to open the Review Gate on a real paused gate (spec+plan) and confirm visually: single full-width panel, two labeled groups with divider, default-active first spec, renderer switches on tab click, drift dot appears after a refresh that reports drift
