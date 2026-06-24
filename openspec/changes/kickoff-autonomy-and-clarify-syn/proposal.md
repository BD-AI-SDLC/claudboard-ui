## Why

A real run (`craftsphere.cloud` / PLAT-26374, 2026-05-26) burned $7.45 over 468 seconds while silently bypassing two human gates in the generated `feature-workflow` skill: the **autonomy selection** gate (early in Phase 1-pre) and the **Phase 1-syn synthesis confirmation** gate. Both were implemented with patterns that cannot pause a headless SDK run — the autonomy gate called `AskUserQuestion`, which returned an empty answer immediately under the `sdk-cli` entrypoint; the 1-syn gate printed `"Reply \`confirm\` or \`correct: <feedback>\`"` and ended the turn, which terminated the run instead of pausing it. The skill marched past both as if the user had answered, then exited at the next print-and-pray prompt. The user never saw any prompt and had no way to intervene.

The `workflow-instrumentation` spec already prohibits these patterns — `mcp__bosch__clarify_request` is mandated as the only mechanism for the orchestrator to ask the user mid-run. The generated skill in `craftsphere.cloud` violates that rule at two sites. This change closes the gap two ways: lifts the autonomy choice out of the run entirely (collected at kickoff, passed in the initial prompt, never asked mid-run), and brings the 1-syn confirmation under the existing `clarify_request` contract so it renders inline in `InterviewPane`.

## What Changes

- **Protocol:** `CreateRunRequest` gains a required `autonomy: 'autopilot' | 'balanced' | 'guided' | 'manual'` field. The persisted `Run` record gains an `autonomy` field so the Active Run UI can display the selected level.
- **Server:** `POST /api/runs` validates `autonomy` against the four allowed values (400 on missing/invalid). The initial prompt becomes `/start-feature --autonomy=<level> <user-prompt>`. The `runs` table gains an `autonomy` column.
- **Server:** `checkFeatureWorkflowSkill` is extended to reject any `SKILL.md` that contains `AskUserQuestion`, a literal `Reply \`confirm\`` prompt, or other "print and end the turn" patterns outside typed `mcp__bosch__*` emissions. Same UX as the existing outdated-skill rejection.
- **UI (Kickoff):** A 4-way autonomy radio is added next to the prompt textarea, seeded from the project's `config.clarify.defaultAutonomy`. The submit payload includes `autonomy`. The preview pane reflects the selection.
- **Skill (separate, no proposal):** The generated `feature-workflow/SKILL.md` in `craftsphere.cloud` is updated to (a) parse `<autonomyLevel>` from the `--autonomy=<level>` flag in the initial prompt and never call `AskUserQuestion` for autonomy, (b) replace the Phase 1-syn `"Reply \`confirm\`"` print-and-pray block with a `mcp__bosch__clarify_request` call carrying the synthesis text as the question.

## Capabilities

### Modified Capabilities

- `run-driver`: `CreateRunRequest` becomes `{ projectId, prompt, target, autonomy }` (required). The initial prompt construction becomes `/start-feature --autonomy=<level> <user-prompt>`. The persisted `Run` record carries `autonomy`.
- `web-ui`: The Kickoff screen renders a required autonomy selector seeded from the project's default; the kickoff payload includes `autonomy`.
- `workflow-instrumentation`: Adds a requirement that the generated SKILL parses the `--autonomy` flag from the initial prompt and never prompts for autonomy. Adds a requirement that the Phase 1-syn synthesis confirmation is one of the `clarify_request` sites (fifth site, alongside the four already enumerated). Adds a requirement that the server's skill-validation gate rejects skills containing the proscribed patterns.

### New Capabilities

None. This change tightens existing capabilities; it does not introduce a new surface area.

## Impact

- **Protocol (`protocol/src/`):** `CreateRunRequest` and `Run` types gain `autonomy`. A string-literal union type `Autonomy = 'autopilot' | 'balanced' | 'guided' | 'manual'` is exported.
- **Server (`server/src/`):**
  - `db.ts`: add `autonomy TEXT NOT NULL` column to `runs` (with an additive migration that backfills `'balanced'` for existing rows so the NOT NULL constraint holds).
  - `run/routes.ts`: validate `autonomy`; pass to `buildPrompt` and `createRunRecord`.
  - `run/prompt-builder.ts`: `buildPrompt(userPrompt, autonomy)` emits `"/start-feature --autonomy=<level> <userPrompt>"`.
  - `run/record.ts` (or wherever `createRunRecord` lives): persist `autonomy`.
  - `run/skill-check.ts`: extend `checkFeatureWorkflowSkill` to detect un-instrumented gate patterns; return a distinct `reason` so the UI can surface a clear "re-generate" prompt.
  - `__tests__/`: new tests for autonomy validation, prompt format, skill-check rejection of bad patterns.
- **UI (`ui/src/`):**
  - `api/client.ts`: `createRun` payload type gains `autonomy`.
  - `components/Kickoff/Kickoff.tsx` + `Kickoff.css`: autonomy radio control; default-from-project wiring.
  - `components/ActiveRun/ActiveRun.tsx`: optional — display the run's `autonomy` in the telemetry header.
- **Skill (`craftsphere.cloud/.claude/skills/feature-workflow/SKILL.md`):** edited directly per agreed scope (no proposal in that repo). The "Clarification autonomy" section is replaced with a parsing rule; the Phase 1-syn "Reply `confirm`" block becomes a `mcp__bosch__clarify_request` call carrying the synthesis text.
- **No breaking changes** to clients that already populate the kickoff form — the UI is updated in the same change. Direct API consumers (if any) will receive a 400 until they include `autonomy`; this is intentional.
- **Coordination risk** (called out): the app change and the skill change must land together. The extended `checkFeatureWorkflowSkill` enforces this at kickoff time — any repo whose skill still contains the proscribed patterns is rejected with a "re-generate" prompt.
- **Out of scope, called out as follow-up:** the skill template at `claude-repo-scan/skills/claudboard-workflow/references/feature-workflow.template/SKILL.md.template` should receive the same edits so future `/claudboard-workflow` regenerations produce compliant skills by default. Not landing in this change because the user explicitly scoped the skill edit to `craftsphere.cloud` only.
