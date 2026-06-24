## Why

The `claudboard` family of skills (`/claudboard-analyse`, `/claudboard-generate`, `/claudboard-workflow`, plus `techdebt` and `refresh`) ask the user free-form and choice questions mid-execution via prose prompts like `> [continue / re-run]`. The Claude harness only pauses for `AskUserQuestion` or end-of-turn — printed prose is not a pause point, so the user sees the question scroll past while the model picks a default and proceeds. Running these from inside bosch-sdlc compounds the problem: there is no editable prompt surface for the user once the Agent SDK invocation has started.

## What Changes

- Add a new `claudboard-runner` capability that gathers every input a claudboard skill would otherwise ask about, **before** the Agent SDK is invoked, then runs the skill non-interactively with all answers baked into the prompt.
- Per supported skill, introduce a Zod input schema in `protocol/` describing the full set of answers the skill would ever need.
- Add a `POST /api/claudboard/run` Express route in `server/` that validates `{ skill, inputs }` against the per-skill schema and, on success, starts a run with a parameterised prompt that includes the line "all answers provided below; do not ask any further questions; auto-approve all gates."
- Add a per-skill modal form to the UI rendered when the user clicks the claudboard skill button. On submit, the form posts to the new endpoint; events stream back via the existing WebSocket broadcast pattern.
- Priority skills covered: `analyse`, `generate`, `workflow`. Follow-up coverage: `techdebt`, `refresh`. Out of scope: `workspace-init`, `workspace-link` (run rarely; fine via CLI).
- The claudboard skill source files themselves are **not** modified — their "ask the user" branches simply never fire because the answers are already in the prompt.

## Capabilities

### New Capabilities
- `claudboard-runner`: form-driven, non-interactive launcher for claudboard skills from the bosch-sdlc UI. Owns the per-skill input schemas, the launch endpoint, the prompt-template rendering, and the form metadata the UI consumes.

### Modified Capabilities
<!-- None. Additive feature. Reuses run-lifecycle, web-ui, and gate-bridge surfaces without changing their requirements. -->

## Impact

- **protocol/**: new `claudboardSkill*` Zod schemas (one per supported skill) and a discriminated union; new event types if needed for skill-specific progress (likely reuses existing run events).
- **server/**: new `claudboard/` module with `routes.ts`, prompt templates per skill, and the launch handler that wires into the existing run orchestrator.
- **ui/**: new modal form components per supported skill, an API client method for the launch endpoint, and a launcher entrypoint in the relevant dashboard screen.
- **External**: depends on the claudboard plugin being installed in `~/.claude/plugins/marketplaces/claudboard/`. If absent, the launch endpoint returns a clear error.
- **No breaking changes**: existing run, gate, and prereq flows are untouched.
