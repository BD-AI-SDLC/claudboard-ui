## Context

The Project screen has two related concerns wired through the same data path:

1. **Setup state** — does this Project have the artifacts needed to run a feature workflow?
2. **Freshness state** — are those artifacts current with the code and with each other?

Today the code conflates them. `setupDone` in `Project.tsx:117` is `every(op => state === 'done')`, which treats a `stale` op identically to a `missing` one. Both the `SetupBanner` (renders unless `setupDone`) and the TopBar's `startFeatureDisabled` (set to `!setupDone`) inherit that conflation. The downstream effect is jarring: a Project the user onboarded last month loses Start Feature, and is told to "set up Mileva for this repo" again, simply because three days passed and someone committed.

The user agreed during exploration that:
- Stale should mean "functional, recommend refresh", not "blocks work".
- Once foundation exists, Maintenance is the actually-recurring concern and deserves the prime visual slot.
- Staleness should cascade through the foundation chain (`analyse → generate → workflow`), because the downstream artifacts are derived from the upstream ones.
- Maintenance ops keep the existing git-activity heuristic; the Refresh maintenance op specifically is what users should reach for to recover from drift (it performs a delta update of `.claude/`, not a full re-render).
- The per-op stale reason should be surfaced ("Stale — codebase changed" vs "Stale — analyse was re-run") because they tell the user different things about what to do.
- The Kickoff screen should carry a subtle hint when the user proceeds despite drift, but should NOT block.

## Goals / Non-Goals

**Goals:**
- The "Set up Mileva for this repo" banner only renders when at least one foundation artifact is `missing`.
- The TopBar's Start Feature button is enabled whenever all three foundation artifacts exist, regardless of staleness.
- When foundation exists and any op is stale, the Project screen surfaces a calm "Refresh recommended" strip pointing the user at `/mileva-refresh`.
- When foundation exists (with or without staleness), Maintenance renders above Foundation, and Foundation collapses to a compact summary with an expand caret.
- Each stale foundation op displays *why* it is stale (one of: `aged-out`, `codebase-changed`, `upstream-changed`).
- Foundation staleness propagates downstream via a dependency DAG: re-running `/mileva-analyse` flips `generate` and `workflow` to `upstream-changed` without any code change or 7-day wait.
- The Kickoff screen shows a single-line drift hint above the prompt textarea when applicable, with a deep link back to the Project screen.

**Non-Goals:**
- Building a new "diff preview" UI for foundation drift. The strip points at `/mileva-refresh`; understanding the delta is `/mileva-refresh`'s job to surface.
- Auto-running `/mileva-refresh` on drift. The system suggests; the user decides.
- Reworking how Maintenance ops are detected. `refresh` remains always-stale; `techdebt` keeps git-activity.
- Per-rule freshness tracking inside `.claude/rules/`. Foundation is tracked at the artifact-level, same as today.
- Inventing a new staleness reason for "user manually re-ran `/mileva-refresh`". A successful Refresh run rewrites the artifact mtimes; the cascade already resolves from there.
- Backfilling `staleReason` for prereq records persisted before this change ships. On first detection after upgrade the field is populated; until then it stays `null` and the UI hides the per-card reason line for those rows.

## Decisions

### D1. Cascade DAG model for foundation staleness

**Choice:** Foundation prereqs are evaluated in dependency order. The leaf (`analyse`) uses the git-activity heuristic; each downstream node inherits staleness if (a) its upstream is stale, or (b) its upstream artifact has a newer mtime than itself.

```
analyse                            generate                              workflow
─────────                          ─────────                             ─────────
mtime > 7d?                        analyse.stale?                        generate.stale?
git log --since=mtime non-empty?   analyse.mtime > generate.mtime?       generate.mtime > workflow.mtime?
              │                                  │                                     │
              ▼                                  ▼                                     ▼
   reason: 'aged-out'                  reason: 'upstream-changed'           reason: 'upstream-changed'
        or 'codebase-changed'
```

**Why over independent git-activity per op:**
- The user's mental model: re-running `/mileva-analyse` invalidates everything downstream. The DAG matches that intuition.
- A single commit landing in the repo (a typo fix, a README edit) should not independently mark `generate` stale via the git heuristic — `generate` should only be stale because `analyse` is stale (i.e. because the source-of-truth for `generate` has shifted). This avoids flagging downstream artifacts as drifted for code changes too small to warrant a re-analysis.
- The graph is small and acyclic; evaluation is O(n) in dependency order. No new dependencies, no library.

**Trade-off:** A single commit no longer independently flips `generate` and `workflow` to stale — only `analyse` does, and only then do `generate`/`workflow` follow. If the user wants `generate` to flag a commit independent of `analyse`, they have to re-run `/mileva-analyse` first. We judge this is the desired behavior: the canonical "source of truth changed" signal is "re-analyse the codebase".

### D2. `staleReason` is a new typed enum on `PrereqRecord`

**Choice:** Add `staleReason: 'aged-out' | 'codebase-changed' | 'upstream-changed' | null` to `PrereqRecord`. Null whenever `state !== 'stale'`. When multiple reasons could apply (e.g. an `analyse` artifact is both >7d old AND has git commits since), pick the most specific: `upstream-changed` > `codebase-changed` > `aged-out`. (`upstream-changed` only applies to non-leaf ops, so for `analyse` the precedence is `codebase-changed` > `aged-out`.)

**Why a typed enum and not a free-form string:** the UI renders a different sentence per reason; type-checking the rendering path is worth more than the flexibility of a free-form message. Future reasons can be added by extending the union.

**Persistence:** SQLite gets a nullable `stale_reason TEXT` column. The column is populated on every detection pass; if a future pass downgrades a row to `done`, the column is cleared.

### D3. `foundationExists` replaces `setupDone` as the layout / Start-Feature gate

**Choice:** Introduce `foundationExists = FOUNDATION_OPS.every(op => prereqs[op.id]?.state === 'done' || prereqs[op.id]?.state === 'stale')`. This is the predicate for:
- Whether the "Set up Mileva for this repo" banner renders (it does when `!foundationExists`).
- Whether the TopBar's Start Feature button is enabled (`startFeatureDisabled = !foundationExists`).
- Whether the Project screen swaps Maintenance above Foundation.

`setupDone` (all `done`, no `stale`) is no longer used as a gate; it survives only as the trigger for the "all green" collapsed banner copy variant.

**Why:** This is the entire UX change in one line of logic. Everything else cascades from it.

### D4. The "drift detected" strip targets `/mileva-refresh`, not a re-run of foundation

**Choice:** When `foundationExists && anyStale`, render a single amber strip above Maintenance:

```
↻  Foundation drift detected — N of 3 artifacts stale.
   Run Refresh below to update, or re-run individual steps.
```

The strip has no own button; it points at the Maintenance Refresh card, which is highlighted with a `Recommended` chip while any foundation op is stale.

**Why no own action button:**
- `/mileva-refresh` is a delta operation, not a full re-render. It is the *recommended* response to drift. Surfacing it via the Maintenance card (which already exists with `[▶ Run]`) keeps one canonical action.
- Adding a "Refresh all" button on the strip risked implying that the strip would re-run analyse + generate + workflow in sequence. That would be a full re-render, which is the wrong semantics for "drift" — and the wrong workload (full re-runs are minutes each).
- The expanded Foundation chain still has per-op `↻ Refresh` buttons for users who want a full re-run of a single step.

**Recommended chip visual:** small violet chip on the Maintenance Refresh card's title row, e.g. `↻ Refresh  [Recommended]`. Disappears when `!anyStale`.

### D5. Layout swap: Maintenance above Foundation when `foundationExists`

**Choice:** Two layout modes in `Project.tsx`. The same `FoundationChain` (3 step cards) is rendered in both — only the order relative to Maintenance changes:

```
foundationExists === false (≥1 missing)
────────────────────────────────────────
   SetupBanner ("Set up Mileva for this repo")
   FoundationChain (3 step cards)
   PrereqInterview (if a run is in-flight)
   MaintenanceGrid (2 cards)

foundationExists === true (all 3 artifacts present)
────────────────────────────────────────────────────
   [FoundationDriftStrip — only if anyStale]
   MaintenanceGrid (2 cards) [Refresh chipped Recommended if anyStale]
   PrereqInterview (if a run is in-flight)
   FoundationChain (3 step cards)
```

The Foundation section is always shown in full — no compact summary, no collapse/expand. Per-op stale reasons render inside each `OperationCard` (D6) so the chain itself communicates drift without a separate summary surface.

**Why no compact summary:** an earlier iteration introduced a `FoundationCollapsed` component (chips with stale-reason short labels + expand caret). The chips duplicated information the per-card status badges already showed, and the collapse/expand interaction didn't earn its weight visually. Removing it keeps the page predictable — the Foundation section always looks like the Foundation section, regardless of mode.

### D6. Stale-reason rendering in the OperationCard

**Choice:** When `visualState === 'stale'`, the OperationCard renders the existing `Stale` status badge, and immediately below the description line adds a single short line of text:

| `staleReason`        | Rendered text                                  |
|----------------------|------------------------------------------------|
| `aged-out`           | `Stale — older than 7 days`                    |
| `codebase-changed`   | `Stale — codebase changed since last run`      |
| `upstream-changed`   | `Stale — {upstream op title} was re-run`       |
| `null` (legacy row)  | (no reason line — preserves backwards compat)  |

For `upstream-changed`, the upstream op title is the human-readable title of the immediate predecessor in `FOUNDATION_DEPS` (e.g. for `generate`, that's `Analyse`; for `claudboard-workflow`, that's `Generate`). The detector emits the immediate predecessor only — the UI does not need to traverse the chain.

**Why immediate predecessor only:** the cascade collapses at evaluation time. If `analyse` is `codebase-changed`, then `generate` becomes `upstream-changed` (reason: `Analyse was re-run / has changed`) and `workflow` also becomes `upstream-changed` (reason: `Generate has changed`). Both downstream reasons stay on their immediate parent — chasing the chain doesn't add information for the user, who can see the full row in the collapsed Foundation summary anyway.

### D7. Kickoff drift hint

**Choice:** In `Kickoff.tsx`, above the prompt textarea, render a single line when the active Project has `foundationExists && anyStale`:

```
↻ Foundation may be out of date — refresh first
```

`refresh first` is a link styled like inline body text (underlined on hover) that navigates to `/projects/:id` (the Project screen). No banner, no callout box — one line of muted-amber text, height ~18px.

**Why subtle:** Start Feature is no longer blocked by drift, so the user clearly chose to proceed. The hint is a courtesy nudge, not a gate. A heavier UI element would feel scolding.

**Why no hint when `!foundationExists`:** that path is already blocked by the disabled Start Feature button on the previous screen — the Kickoff page is not reachable without foundation in the first place.

### D8. Detection runs server-side, not duplicated in the client

**Choice:** The cascade DAG lives in `server/src/registry/prereqs.ts`. The client reads `state` and `staleReason` straight off `PrereqRecord` and never re-evaluates the chain locally.

**Why:** mtimes and `git log` are filesystem operations — they belong on the server side that owns the repo path. Putting the DAG on the client would either require shipping mtimes over the wire and recomputing per render, or risk client/server divergence. The server is already the single source of truth for prereq state today; the cascade additions stay in the same place.

**Implication for `setup-utils.ts`:** `deriveVisualState` and `deriveFoundationStates` keep their existing shape — they map `PrereqState` → `VisualState`. They do NOT re-derive staleness. The new `staleReason` field is plumbed through as a separate value carried alongside `VisualState`.

### D9. Schema migration for the new column

**Choice:** Add a tiny migration in the server bootstrap: `ALTER TABLE prereqs ADD COLUMN stale_reason TEXT` wrapped in `IF NOT EXISTS` semantics (or guarded by a `PRAGMA table_info` check, since SQLite's `ALTER TABLE ... ADD COLUMN` doesn't take `IF NOT EXISTS` directly).

**Why:** `bosch-sdlc` is a localhost dev tool with a single SQLite file per user. No version table is needed — the bootstrap inspects the columns of `prereqs` and runs the ALTER only if `stale_reason` is absent. This is consistent with the existing `~/.bosch-sdlc/state.db` ergonomics.

**Backwards compatibility:** older rows have `NULL` in the new column. On the next detection pass for that Project, the column populates. Until then, the UI hides the per-op reason line (D6) so legacy rows render unchanged.

## Risks / Trade-offs

- **[User runs `/mileva-refresh` but downstream artifacts still flag `upstream-changed`]** → `/mileva-refresh` is a delta update of `.claude/`. It rewrites `CLAUDE.md` and any rules that changed, which moves `generate.mtime` forward. After Refresh, the cascade re-evaluation should clear the downstream `upstream-changed` reason. Test for this explicitly in the integration test: trigger a Refresh, re-detect, assert all three foundation ops return to `done`. If Refresh does NOT touch the relevant artifact mtimes for some scenario, the user will need to re-run the foundation step explicitly — the per-op `↻ Refresh` button on the expanded chain card covers that.

- **[Cascade hides the original git-activity signal on downstream ops]** → On purpose. Today, `generate` flags `stale` independently when any commit lands; under the cascade, `generate` only flags stale when `analyse` is stale. If a user is committing without re-analysing, only `analyse` shows `codebase-changed`. We judge that's clearer (one signal at the root of the chain) rather than three identical-looking signals. The strip's "N of 3 stale" count grows naturally as the cascade propagates, so the page-level signal is unchanged.

- **[Start Feature now possible on stale artifacts]** → The run might produce slightly out-of-date output (the workflow skill references a now-drifted CLAUDE.md). The user is given two signals to recognize this: the Project screen's drift strip + Recommended chip, and the Kickoff screen's one-line hint. Acceptable trade-off — the alternative (block work for a soft signal) was the bug.

- **[Layout swap changes muscle memory]** → Users who learned "Foundation is at the top" now see Maintenance there once setup is complete. Mitigation: the swap is only triggered AFTER setup completes, so first-time users see the old layout; the swap rewards completion with a useful reorder. The collapsed Foundation strip is still visible (just below Maintenance), preserving discoverability.

- **[`PrereqRecord` shape change requires protocol bump]** → The new `staleReason` field is nullable and not consumed by any existing code path, so this is additive. No major version bump needed. Older UI builds that read `PrereqRecord` ignore the new field; server treats absent / null as "no reason".

- **[Foundation collapsed summary becomes stale-looking when nothing is stale]** → When all ops are `done` and the section is collapsed, the chips read `[ ✓ analyse ] [ ✓ generate ] [ ✓ workflow ]` with no reason text. The header reads `▾ Foundation  3/3 fresh`. This is the calm steady state and is intentional — we want the page to feel quiet when everything is healthy.
