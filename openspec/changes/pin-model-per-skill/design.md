## Context

The bosch-sdlc server spawns Claude two ways:

```
runPrereqViaCli  (spawn 'claude --print ...')   ── prereq runs of all 5 claudboard skills
runFeature       (Agent SDK query())            ── feature orchestrator + 3 claudboard skills
```

Neither passes a model today. The CLI resolves the model from `~/.claude/settings.json` / `ANTHROPIC_MODEL` / built-in defaults; the SDK does likewise via its embedded CLI. Same code, different model per machine. The cost engine already observes this — `phase_costs.model` records whatever the session JSONL reports — but the server can't enforce it.

Three skills (`analyse`, `generate`, `workflow`) are reachable through **both** invocation paths: the "prereq" CLI button uses `runPrereqViaCli`; the "claudboard run" launcher uses `runFeature` via `claudboard/launcher.ts`. A user expects `/analyse` to use the same model regardless of which button they hit.

## Goals / Non-Goals

**Goals:**
- Hard-pin the Anthropic model used by each skill, keyed on skill identity.
- Single source of truth: one map, both paths consume it.
- Same skill → same model across paths (dual-path skills are not allowed to drift).
- Visible verification: server logs the resolved model per run; cost telemetry confirms it post-hoc; tests assert it at build time.

**Non-Goals:**
- No user-facing model selector (UI or API).
- No per-environment override (env var, settings file, DB row).
- No fallback to the user's CLI default if the pin is unavailable — fail loud rather than silently mis-route.
- No model selection per phase *within* a single skill run — the orchestrator and any sub-agents inside `runFeature` are governed by whatever model the SDK passes through; per-phase routing is owned by the skill scripts themselves (out of scope for this change).
- No DB migration. The existing `phase_costs.model` column already captures observed model and becomes our runtime check.

## Decisions

### D1 — Map lives in `protocol/`, not `server/`

```typescript
// protocol/src/models.ts
export const MODELS = {
  analyse:  'claude-opus-4-7[1m]',
  generate: 'claude-sonnet-4-6[1m]',
  workflow: 'claude-sonnet-4-6[1m]',
  refresh:  'claude-opus-4-7[1m]',
  techdebt: 'claude-opus-4-7[1m]',
  feature:  'claude-sonnet-4-6[1m]',
} as const

export type SkillKey = keyof typeof MODELS
export type PinnedModel = (typeof MODELS)[SkillKey]
```

**Why:** the project's "never duplicate types" rule forbids re-declaring shared constants in `server/`. Putting it in protocol also lets the UI surface a model badge later without copying strings. **Alternative considered:** `server/src/models.ts` — fewer rebuild steps but creates a drift surface if the UI ever needs the same names.

### D2 — `runFeature` takes a `model` parameter; callers pick

Signature changes from `runFeature(runId, target, prompt)` to `runFeature(runId, target, prompt, model)`. The three callers each know which pin they want:

```typescript
// server/src/run/routes.ts
runFeature(record.id, body.target, prompt, MODELS.feature)

// server/src/claudboard/launcher.ts (skill ∈ { analyse, generate, workflow })
runFeature(record.id, target, prompt, MODELS[request.skill])
```

`runFeature` passes the model through to `query({ options: { model } })` and emits one `console.info` line at spawn time.

**Why not infer from the run row's `kind`?** Cleaner to make the dependency explicit at the call site — the caller is the source of intent. Inferring would require `runFeature` to import `MODELS` and a kind→skill mapping, coupling the driver to the catalog.

### D3 — `runPrereqViaCli` looks up the model from its existing `cmd` argument

```typescript
const slashCommand = CMD_TO_SLASH[cmd]
const model = MODELS[cmd as SkillKey]  // cmd is already constrained to skill keys
if (!model) {
  markFailed(db, runId, `Internal error: no model pinned for "${cmd}"`)
  return Promise.resolve()
}
spawn('claude', ['--print', ..., '--model', model, ...])
```

The existing `cmd` parameter already enumerates `analyse | generate | claudboard-workflow | refresh | techdebt`. Aligning the map keys to match (`workflow` vs `claudboard-workflow`) is the only naming question — see Risk R3.

### D4 — Failure mode: hard-fail on missing/invalid pin

If `MODELS[skill]` is undefined or the underlying CLI/SDK rejects the model string, the run fails fast (existing `markFailed` path). We do **not** fall back to a default model — silent fallback would re-introduce exactly the variability we're fixing.

### D5 — Verification is multi-layer, not single-layer

| Layer        | Mechanism                                                          | Catches                                  |
|--------------|--------------------------------------------------------------------|------------------------------------------|
| Build-time   | Jest test: mocks `spawn` + SDK `query`, asserts model arg per skill | Drift in code; missing call-site updates |
| Runtime log  | `console.info('[run <id>] model=<m> skill=<s>')` at each spawn site | Operational visibility; replay debugging |
| Post-hoc DB  | `phase_costs.model` recorded by cost engine                         | End-to-end confirmation in production    |

## Risks / Trade-offs

**R1 — Agent SDK may not accept the `[1m]` bracketed form via `options.model`.**
The `[1m]` suffix is a Claude Code CLI convention written by `/model`. The Agent SDK shells out / embeds the same machinery, so it *should* accept the same strings — but unverified.
→ **Mitigation:** pre-implementation spike. Run `claude --model 'claude-sonnet-4-6[1m]' --print "hi"` to confirm the CLI accepts it; then a one-off SDK smoke test against `query({ options: { model: 'claude-sonnet-4-6[1m]' } })`. If the SDK rejects `[1m]`, fall back to plain IDs (`claude-opus-4-7`, `claude-sonnet-4-6`) — same model family, 200k context instead of 1M, no behavioral split between CLI and SDK paths.

**R2 — `claude-sonnet-4-6[1m]` may not be GA on the deploy target.**
1M-context Sonnet rollout is account-gated. If unavailable, the run hard-fails (per D4).
→ **Mitigation:** same spike as R1. If unavailable, downgrade Sonnet pins to plain `claude-sonnet-4-6`.

**R3 — Key naming mismatch between code paths.**
The CLI runner uses `claudboard-workflow` as its key; `claudboard/launcher.ts` uses `workflow`. Pick one canonical name for `MODELS`, then either rename the CLI cmd or add a small alias.
→ **Mitigation:** use `workflow` as the canonical key (matches the skill domain); update `CMD_TO_SLASH` and the launcher's switch consistently. Document in `tasks.md`.

**R4 — Model upgrades require a code change.**
Pinning by definition removes the ergonomic "just bump the CLI default" workflow. Every model bump is now a PR.
→ **Accepted.** This is the point of the change — reproducibility over ergonomics. If the bump cadence becomes painful, a follow-up could read pins from a config file at server boot (still no per-user override).

**R5 — Cost increases if Opus pins overshoot the actual need.**
The cost engine already tracks per-skill spend, so this becomes measurable rather than guessed.
→ **Accepted.** Re-tune pins post-launch based on `phase_costs` aggregates.

## Migration Plan

1. **Spike (15 min):** run the `claude --model` smoke check above. Lock the final ID set (with or without `[1m]`).
2. Land the change behind no flag — pinning is the new default. Servers built from this commit immediately route per-skill.
3. **Rollback:** revert the commit. The signature change on `runFeature` makes this a single-commit revert (no DB or protocol breakage).
4. **Post-deploy check:** kick off one run per skill, query `SELECT skill_kind, model FROM phase_costs ORDER BY created_at DESC LIMIT 20` (or equivalent join) and confirm each row's `model` matches the pin.

## Open Questions

- Should the orchestrator's pin (`feature`) be overridable for a specific run while still hard-pinning per-skill claudboard runs? Current scope says no. If the feature workflow team later needs to A/B model choices for the orchestrator only, we can add a per-run override on `POST /runs` without touching the claudboard paths.
- Do we want a tiny `GET /api/models` endpoint that returns the pinned map, so the UI can render a "this run uses model X" badge before the first phase emits cost? Out of scope here; trivial follow-up.
