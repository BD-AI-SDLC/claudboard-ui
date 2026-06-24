## Context

`foundation-staleness-soft-gate` (PR #11, merged) introduced a cascade-DAG staleness model for the three foundation prereqs:

- `analyse` uses a git-activity heuristic (commits since artifact mtime) and an aged-out heuristic (mtime > 7 days).
- `generate` and `claudboard-workflow` inherit staleness via `upstream-changed` whenever their predecessor's mtime moves.
- The UI surfaces this with a `FoundationDriftStrip`, per-card reason lines, a `Recommended` chip on the Maintenance Refresh card, a Kickoff drift hint, and a `foundationExists`-keyed layout swap.

The model is internally coherent but does not match how the tool is actually used. The three foundation skills are onboarding rituals — run once at the start of working on a repo. Once their artifacts exist, the user does not want them to be re-evaluated for staleness, because:

1. Every routine commit to the repo flips `analyse` to `stale (codebase-changed)`, which cascades downstream and produces noise that nudges the user toward redundant re-runs.
2. After 7 days the same happens via `aged-out`, even on a quiet repo.
3. The user's actual mental model is `setup → use` followed by `refresh` for ongoing drift management. `refresh` already exists and is the dedicated answer to "the codebase changed enough to update my rules."
4. The cascade machinery has been observed gating workflow starts in practice — the Start Feature button stays enabled per the soft-gate spec, but the prominent "drift detected" strip and the Kickoff hint push users into re-running setup steps before starting a feature, which was never the intent.

This change rolls back the foundation-side staleness machinery and reframes `refresh` as the canonical drift response. `techdebt` is unaffected — it is a separate analysis with its own cadence and keeps its independent git-activity heuristic.

## Goals / Non-Goals

**Goals:**

- Foundation prereqs report `done` once their artifact is on disk and never flip back to `stale` automatically.
- The Project screen layout swap (Maintenance above, Foundation below) and Start Feature enablement use the same simple "all three artifacts exist" predicate.
- The Project page post-setup is dominated by the live action — Maintenance — with the Foundation cards present as inert "Setup complete" tiles at the bottom for completeness.
- Drift handling lives entirely in `refresh` (and `techdebt`, independently).

**Non-Goals:**

- In-app "Delete artifact and re-run" UI for foundation cards. Terminal `rm` is the documented escape hatch for this change.
- Smarter refresh recommendation (overlapping the actual diff against active rules/skills). The Refresh card's existing "always stale, always clickable" behavior is preserved; only its description copy changes.
- Changes to `techdebt`. It keeps the git-activity heuristic and its `staleReason` semantics (`aged-out`, `codebase-changed`).
- Schema migration. The `stale_reason TEXT` column added by `foundation-staleness-soft-gate` stays; foundation rows just stop populating it.

## Decisions

### Decision: Foundation states are binary `missing | done`. No `stale`.

**Rationale.** The user's framing is the source of truth: these are one-time setup tasks. A two-state model — artifact exists or it doesn't — eliminates the entire class of noise the cascade DAG produces, and it matches the only useful signal the UI actually needs (should we render Setup mode or Operational mode).

**Alternatives considered:**

- *Keep `stale` as a hidden internal signal, show nothing in the UI.* Rejected because the persistence cost (column, detection branches, test surface) is non-zero and pays for nothing visible. If we ever need it, we can add it back with the column already present.
- *Keep `aged-out` only, drop `codebase-changed` and `upstream-changed`.* Rejected because aged-out is the weakest of the three signals (a quiet repo can be "stale" for no semantic reason) and would still produce noise without the cascade.

### Decision: Re-run path is manual artifact deletion via terminal.

**Rationale.** The locked-card design intentionally has no click target. The user who needs to redo `analyse` is rare and can be expected to `rm .claude/reports/claudboard-analysis.md` and re-run the skill. Avoiding an in-app destructive action surface keeps the post-setup Project screen safe to click anywhere.

**Alternatives considered:**

- *Overflow menu on the locked card with "Delete artifact and re-run".* Tracked as future work (see "Future work" below). Worth doing once we have a story for confirming destructive actions consistently across the app, but not in this change.
- *Tooltip hint on the locked card explaining the `rm` path.* Considered, declined — the locked state is intentionally inert; documenting the escape hatch in the project README is sufficient.

### Decision: `refresh` is reframed in copy but unchanged in behavior.

**Rationale.** `refresh` already does the right thing — it's always clickable, always stale, and the underlying skill (`/mileva-refresh`) performs delta updates of `.claude/` against recent code changes. The user has flagged that the current description undersells its role; rewriting the card description (and only that) is a free improvement.

**Alternatives considered:**

- *Add a "since last refresh" delta count.* Worth doing, but it depends on smarter detection (see Future work). Out of scope here.
- *Auto-recommend refresh when a heuristic fires.* Explicitly rejected for this change — the whole point is to stop noisy recommendations. The future-work item (b) does this *properly*, based on actual diff overlap, not a calendar.

### Decision: Layout swap and Start Feature gate use `foundationDone` (all three `done`).

**Rationale.** Under the soft-gate model, `foundationExists` and `foundationDone` were distinct predicates because foundation could be `done` *or* `stale`. With this change they collapse into one predicate — `all three are 'done'` — but we name it `foundationDone` because the semantics are now unambiguous.

The `setup-utils.ts` helper keeps the `foundationDone` export. Any remaining `foundationExists` references are replaced with `foundationDone` (or the helper is renamed if no external references exist).

### Decision: Archive `foundation-staleness-soft-gate` first, then apply this change's deltas.

**Rationale.** OpenSpec's archive step is what merges a change's spec deltas into `openspec/specs/`. If we leave the soft-gate change unarchived, our `MODIFIED Requirements` here can't reliably cite "the full updated content" of the post-soft-gate version — the canonical source of truth for the predecessor text would be in two places (the merged code and an open change directory). Archiving the soft-gate change first lets it land its spec deltas as written, then this change overwrites the affected requirements cleanly.

The soft-gate change's remaining task 14.4 (manual smoke verification of cascade behavior) is dropped — we would be smoke-testing behavior this change immediately removes.

## Risks / Trade-offs

- **[Risk] A user works on a repo for months without ever running `refresh`, so their `.claude/rules` silently drift from the actual codebase, biasing future Claude runs on stale guidance.**
  → Mitigation: Refresh card copy is rewritten to emphasize its role. The future-work item (b) — smart refresh recommendation based on real diff overlap with active rules/skills — is the proper fix and is tracked below. In the interim, the user has the same protection as today: the Refresh card is always present, always clickable, and always rendered with a `Stale` chip.

- **[Risk] A user wholesale rewrites their repo (`/refactor` → all files moved) and the existing `analyse` report is genuinely worthless. With no auto-staleness, they may not realize they should redo it.**
  → Mitigation: terminal `rm` is documented. This case is rare and the user almost certainly already knows they restructured the repo. The locked card's `Setup complete ✓` framing is intentionally honest about what the artifact represents.

- **[Trade-off] The `staleReason` union shrinks from three values to two (`'aged-out' | 'codebase-changed'`). This is technically a breaking change for any consumer that exhaustively switches on the union.**
  → Mitigation: search of `protocol/` and consumers confirms only internal use. No external consumers. TypeScript will catch any missed call sites at build time.

- **[Trade-off] Reverting a 48/49-task change so soon after it merged is unusual and the git history will look noisy.**
  → Mitigation: the openspec history preserves the full story — the soft-gate change is archived as the record of what was tried, this change is archived as the record of what replaced it. Future contributors looking at `openspec/changes/archive/` see both, in order, with their rationales.

## Migration Plan

1. **Pre-deploy.** Archive `foundation-staleness-soft-gate` (`openspec archive foundation-staleness-soft-gate`) so its spec deltas land in `openspec/specs/`. No code changes from this step — it's purely an openspec ledger update.
2. **Implement this change** per tasks.md. Order: server detector → protocol union → UI deletions → UI helpers and Project layout → tests → manual smoke.
3. **No DB migration.** The `stale_reason` column persists. Existing rows with `stale_reason = 'upstream-changed'` are harmless — the next detection pass overwrites them with `NULL` for foundation rows. (They'll never be served, because foundation rows are now `done` or `missing`, and the protocol guarantees `staleReason` is `null` whenever `state !== 'stale'`.)
4. **Rollback strategy.** Pure code revert — `git revert` the implementation PR and re-archive `foundation-staleness-soft-gate` from scratch (or restore it from `openspec/changes/archive/`). No data loss path.

## Future Work (deferred, tracked here for context)

- **(a) In-app "Delete artifact and re-run" overflow menu on locked foundation cards.** The locked `OperationCard` grows an overflow `⋯` menu with a single destructive item. Click triggers a confirmation, then `DELETE /api/projects/:id/prereqs/:cmd/artifact` which `unlink`s the artifact under `resolveUnderWorkspace`, after which the card reverts to `missing` and the standard run button reappears. Requires confirmation UX patterns we don't have established yet.

- **(b) Smart refresh recommendation based on real diff overlap.** Today's `refresh` is "always stale, always clickable." A meaningful upgrade: when the user opens the Project screen, the server computes the diff of the repo since the last `refresh` run, intersects the changed file paths with the paths declared in active `.claude/rules/*.md` `paths:` frontmatter and the skill scripts under `.claude/skills/*/scripts/`, and only marks the Refresh card "Recommended" when there is actual overlap. This replaces the calendar-based and commit-count-based heuristics with a signal that reflects whether the project's Claude context has plausibly been invalidated. Out of scope here because the detection itself is a meaningful piece of work — it deserves its own change.

## Open Questions

_None at this time. The decisions above were taken in an explore session with the user; the locked-card UX (no tooltip, no menu) and the refresh-emphasis copy were both explicit user choices._
