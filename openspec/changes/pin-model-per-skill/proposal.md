## Why

Today neither codepath that spawns Claude passes a model. `runPrereqViaCli` (`server/src/prereq/cli-runner.ts`) omits `--model`, and `runFeature` (`server/src/run/driver.ts`) calls the Agent SDK's `query()` with no `options.model`. Both inherit whatever the user's local Claude Code CLI happens to default to, which means cost, latency, and capability vary per machine and per `/model` selection — invisible to the server, unreproducible across users.

We want fixed, per-skill model pinning: `/analyse` runs Opus, `/generate` runs Sonnet, etc. No user overrides, no system-default reads.

## What Changes

- Introduce a single source of truth that maps each skill identity to a fixed Anthropic model ID, exported from `protocol/` so both server and UI can reference it.
- The CLI invocation path (`runPrereqViaCli`) gains a `--model` flag derived from the skill being run.
- The SDK invocation path (`runFeature`) gains a `model: string` parameter, passed into `query({ options: { model } })`.
- Three callers of `runFeature` (`run/routes.ts`, `claudboard/launcher.ts` for analyse/generate/workflow) pick the correct pin and pass it through.
- Each spawn site logs the resolved model and skill so drift becomes visible in server logs.
- Three skills (`analyse`, `generate`, `workflow`) are dual-path — invokable via either the CLI or the SDK driver. Pinning is keyed by **skill identity**, not by path, so the same skill resolves to the same model regardless of which UI button triggered it.

Pinned models (1M-context variants preferred where supported):

| Skill          | Model                     | Path(s)       |
|----------------|---------------------------|---------------|
| analyse        | `claude-opus-4-7[1m]`     | CLI + SDK     |
| generate       | `claude-sonnet-4-6[1m]`   | CLI + SDK     |
| workflow       | `claude-sonnet-4-6[1m]`   | CLI + SDK     |
| refresh        | `claude-opus-4-7[1m]`     | CLI only      |
| techdebt       | `claude-opus-4-7[1m]`     | CLI only      |
| feature        | `claude-sonnet-4-6[1m]`   | SDK only      |

## Capabilities

### New Capabilities
- `model-pinning`: owns the skill→model map and the contract that every Claude invocation in the server is pinned by skill identity, with no user-facing override and no read of the local CLI/env default.

### Modified Capabilities
<!-- None. `run-driver` and `prereq-runner` specs currently make no commitments about model selection, so this change adds behavior without amending their existing requirements. The new `model-pinning` capability documents what those modules now consume. -->

## Impact

- **New file:** `protocol/src/models.ts` (constant map + `SkillKey` type, re-exported from the protocol barrel).
- **Modified files:**
  - `server/src/prereq/cli-runner.ts` — adds `'--model', MODELS[cmd]` to the spawn argv; adds the resolved-model log line.
  - `server/src/run/driver.ts` — `runFeature(runId, target, prompt, model)` signature; passes `model` into `query({ options })`; adds log line.
  - `server/src/run/routes.ts` — passes `MODELS.feature` to `runFeature`.
  - `server/src/claudboard/launcher.ts` — passes `MODELS[request.skill]` to `runFeature`.
- **New tests:** Jest smoke test mocking `child_process.spawn` and the SDK `query()` to assert the model arg per skill.
- **No DB migration:** the `phase_costs.model` column already exists (recorded by the cost engine). After this change, the recorded value should match the pin — the cost tracker becomes a runtime verification path.
- **No protocol breaking change** for existing REST/WS consumers: the request and event shapes are unchanged.
- **External dependency:** assumes the Anthropic Agent SDK accepts the `[1m]` bracketed model form via `options.model` and that `claude-sonnet-4-6[1m]` is generally available. Both are pre-implementation spike items; mitigation is to fall back to plain IDs (`claude-opus-4-7` / `claude-sonnet-4-6`) — see `design.md`.
