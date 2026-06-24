## Context

The Kickoff page renders three things in sequence: the prompt form, the live preview block, and (below the submit row) a panel titled "Recent in this repo". The first two are wired to real state — repo path, autonomy, slugified prompt, the project key resolved by the recently-merged `kickoff-shows-real-project-key` change. The third is a hardcoded three-row constant that has shipped to every user since the file was first added.

The decision in this change is narrow: delete the panel cleanly, decline to replace it. The motivation, scoping, and out-of-scope items live in `proposal.md`; this document captures the design choices that aren't already obvious from "delete dead code."

## Goals / Non-Goals

**Goals:**
- The Kickoff page SHALL no longer render the "Recent in this repo" heading or any of its rows.
- The deletion SHALL be surgical: only code exclusive to the panel is removed; nothing the rest of the page depends on is touched.
- The change SHALL be reversible by a single revert commit (one component file, one stylesheet file, no migrations, no protocol changes, no API changes).
- The Kickoff page's vertical rhythm and outer container styling SHALL remain visually correct after the panel is removed — no orphaned spacing, no broken layout boundaries.

**Non-Goals:**
- Replacing the panel with a real recent-runs feature. The data layer exists; the UX is its own change.
- Touching any other "Recent runs" surface (Dashboard, Active Run sidebar). They are real and separate.
- Refactoring `Kickoff.tsx` beyond the deletion (no extract-component, no prop rename, no style cleanup).
- Adding a deprecation marker or feature flag. The panel was never real; removal is immediate and complete.
- Tests for the rest of the Kickoff page that are not already present.

## Decisions

### D1: Delete, do not replace

The Kickoff page is currently asymmetric: form + preview are honest, the recent panel is mock. A reader of the file is forced to mentally track which UI is real and which is theatre, which is friction on every future Kickoff change. Deleting the panel removes the asymmetry. A real recent-runs feature, when designed and built, is additive against this clean baseline — and benefits from having decided the UX questions explicitly rather than inheriting them from the mock's shape (three rows, ticket-first layout, no click target, no empty state, no loading state).

### D2: No spec delta

The live `web-ui` spec describes the Kickoff screen's required behaviours: prompt entry, autonomy selection, the topology-invariant form layout, the submit request shape, the branch preview rendering. It does NOT describe a recent-runs panel. Adding a `specs/web-ui/spec.md` delta with a REMOVED requirement would be inventing a prior requirement to remove. The correct OpenSpec posture for "delete UI that was never spec'd" is no spec delta, and the proposal documents the deliberate absence so a future reviewer doesn't read it as oversight.

### D3: Imports stay if still used

`Icon` is also used by the submit button's `rocket` icon. `StatusChip` is imported at the top of the file but its only call site is inside the deleted block — meaning after the deletion, `StatusChip` becomes an unused import. The task list specifies a final-grep step to confirm each import's remaining call sites before deleting any, so neither is removed speculatively and neither is left dangling. The TypeScript `noUnusedLocals` setting in the UI package (verify in `ui/tsconfig.json`) will flag any leftover unused import at build time as a backstop.

### D4: Visual continuity — no compensating spacing

The deleted panel sits inside `<div style={{ marginTop: '28px' }}>` (line 215). After deletion, the surrounding `kickoff__wrap` container collapses to just the card. The card already manages its own bottom spacing via `Kickoff.css`. No replacement margin, padding, or filler is added — the page is meant to end at the card. The `/run` verification step in the task list catches any layout surprise here.

### D5: One smoke test, not a regression suite

A test that asserts "Recent in this repo text is absent" provides the only forward-protection that matters: if a future refactor (or a stale local branch merge) reintroduces the panel, the suite fails loudly. A broader regression suite (every panel that should NOT be on Kickoff) would be inventing maintenance burden for a one-off cleanup. One assertion, one source of truth: the panel is gone.

### D6: CSS deletion is verified by grep, not by build

The CSS prefix lint enforces that class names live in their owning component's stylesheet, but it does not enforce that every class in a stylesheet is referenced. Vite's build won't flag dead CSS either. The task list calls for an explicit `grep` across `ui/src/` for each of the six class names being removed before deletion — a five-second check that confirms the classes truly are exclusive to the deleted JSX.

## Risks / Trade-offs

- **User confusion from missing surface.** A user who notices the panel is gone may wonder if Kickoff is broken. Acceptable risk: the panel was mock data, so the only loss is the visual placeholder; nothing was previously informing real decisions. If users actually relied on it as a "this is where I'd see recent stuff" hint, that's evidence to build the real version — which the proposal explicitly leaves room for.
- **Wasted-work signal for the original author.** Deleting UI someone shipped can read as criticism. Mitigated by the proposal's framing: the prior `kickoff-shows-real-project-key` change already named this as "deferred to its own change," so this change is the planned follow-up, not a teardown.
- **Reintroduction risk.** A stale local branch with the panel still present, merged after this change, would silently restore the mock. Mitigated by D5's smoke test — the test fails on reintroduction, surfacing the conflict at PR time rather than in production.
- **Spec drift if a future change adds a real panel.** When the real recent-runs panel ships, that change must add the corresponding requirements to `web-ui/spec.md` for the first time (no prior requirement to MODIFY). Documented in the proposal's out-of-scope section so the follow-up author has the breadcrumb.
