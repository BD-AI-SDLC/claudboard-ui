## ADDED Requirements

### Requirement: Skill→Model map is the single source of truth

The protocol library SHALL expose a `MODELS` constant that maps every supported skill identity to a single Anthropic model ID. The server SHALL import this constant for every Claude invocation; the server MUST NOT declare model strings inline at any spawn or `query()` call site.

#### Scenario: Map exposes one entry per supported skill
- **WHEN** the protocol package is built
- **THEN** `MODELS` contains exactly the keys `analyse`, `generate`, `workflow`, `refresh`, `techdebt`, `feature`
- **AND** each value is a non-empty Anthropic model ID string
- **AND** a `SkillKey` type alias resolves to the union of those keys

#### Scenario: Server consumes the map at every invocation site
- **WHEN** the server source tree is searched for hard-coded model strings (e.g. `claude-opus`, `claude-sonnet`)
- **THEN** no production source file outside the protocol package contains such a literal
- **AND** all spawn / `query()` call sites resolve their model via `MODELS[...]`

### Requirement: Same skill resolves to the same model across all paths

A skill that can be invoked through multiple codepaths SHALL resolve to a single pinned model regardless of path. The server MUST NOT branch the model choice on which UI button, route, or runner triggered the skill.

#### Scenario: Dual-path skill is consistent across paths
- **WHEN** the `analyse` skill is invoked via `runPrereqViaCli` (CLI spawn)
- **AND** the same `analyse` skill is invoked via `runFeature` (Agent SDK)
- **THEN** both invocations resolve to `MODELS.analyse`
- **AND** the cost engine records the same model string for both runs in `phase_costs.model`

#### Scenario: Skill identity, not run kind, determines the model
- **WHEN** `runFeature` is called for a claudboard `generate` run
- **AND** `runFeature` is called for a feature-orchestrator run
- **THEN** the two invocations resolve to `MODELS.generate` and `MODELS.feature` respectively
- **AND** the choice is determined by the caller's intent, not by the `runFeature` driver inspecting state

### Requirement: CLI invocation pins via the `--model` flag

`runPrereqViaCli` SHALL pass `--model <MODELS[cmd]>` to the spawned `claude` CLI for every prereq run. The flag MUST appear in the argv before any positional arguments.

#### Scenario: CLI spawn includes the resolved model flag
- **WHEN** `runPrereqViaCli(runId, target, 'refresh')` executes
- **THEN** the argv passed to `child_process.spawn` contains the consecutive tokens `'--model'` and `'claude-opus-4-7[1m]'` (or whatever `MODELS.refresh` currently resolves to)

#### Scenario: Unknown skill fails the run
- **WHEN** `runPrereqViaCli` receives a `cmd` that has no entry in `MODELS`
- **THEN** the run is marked `failed` with an internal-error message naming the missing pin
- **AND** no `claude` subprocess is spawned

### Requirement: SDK invocation pins via the `query` options

`runFeature` SHALL accept a `model: string` parameter and forward it as `options.model` to the Anthropic Agent SDK's `query()` call. The driver MUST NOT read the model from any default, env var, or run row.

#### Scenario: SDK query receives the model option
- **WHEN** `runFeature(runId, target, prompt, 'claude-sonnet-4-6[1m]')` executes
- **THEN** the call to `query({ options })` includes `options.model === 'claude-sonnet-4-6[1m]'`

#### Scenario: Caller supplies the model from the catalog
- **WHEN** `run/routes.ts` launches a feature run
- **THEN** it calls `runFeature(..., MODELS.feature)`
- **AND** `claudboard/launcher.ts` calls `runFeature(..., MODELS[request.skill])` for skills `analyse | generate | workflow`

### Requirement: No user override, no system-default read

The server SHALL NOT expose any HTTP, WebSocket, CLI, env-var, or settings-file mechanism that lets a user, operator, or run record override the pinned model. The server SHALL NOT read `ANTHROPIC_MODEL`, `~/.claude/settings.json`, or any other source as a fallback or override.

#### Scenario: Request body cannot influence model
- **WHEN** a client posts to `POST /api/runs` with any model-related field in the body
- **THEN** the field is ignored
- **AND** the run uses `MODELS.feature` unchanged

#### Scenario: Environment variable does not leak in
- **WHEN** `ANTHROPIC_MODEL` is set in the server process environment
- **AND** any skill is invoked
- **THEN** the model passed to the CLI/SDK is `MODELS[skill]`, not the env value

### Requirement: Resolved model is logged at each invocation

Each spawn site SHALL emit one `console.info` line of the form `[run <id>] model=<model> skill=<skill>` immediately before invoking the CLI or SDK. This SHALL happen exactly once per run, on the run-start path.

#### Scenario: Log line accompanies every spawn
- **WHEN** any skill run is started via either `runPrereqViaCli` or `runFeature`
- **THEN** stdout contains one log line naming the run id, the resolved model, and the skill identity

### Requirement: Cost telemetry confirms the pin

The existing per-phase cost record SHALL continue to populate `phase_costs.model` from the session JSONL. After this change, for any completed run, the recorded model SHALL equal `MODELS[skill]` for the skill that triggered the run.

#### Scenario: Recorded model matches the pin
- **WHEN** a `techdebt` run completes successfully
- **AND** at least one phase cost row is written
- **THEN** every `phase_costs.model` row for that run equals `MODELS.techdebt`
