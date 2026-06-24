## 1. Protocol: autonomy type and request/record shape

- [x] 1.1 Add `export type Autonomy = 'autopilot' | 'balanced' | 'guided' | 'manual'` to `protocol/src/types.ts` (or wherever the existing shared types live).
- [x] 1.2 Extend `CreateRunRequest` to include `autonomy: Autonomy` as a required field. Document the field in a JSDoc comment ("Selected at Kickoff; passed to the SKILL via the `--autonomy=<level>` flag in the initial prompt.").
- [x] 1.3 Extend the `Run` record type to include `autonomy: Autonomy`.
- [x] 1.4 Build the protocol package (`npm run build -w protocol`) and confirm no type errors.

## 2. Server: validation, prompt, persistence

- [x] 2.1 Add `autonomy TEXT NOT NULL DEFAULT 'balanced'` column to the `runs` table in `server/src/db.ts`. Run as an additive migration (similar to the existing `gates.snapshot` migration pattern at `db.ts:83-90`): inspect `PRAGMA table_info('runs')`, add the column only if absent. After the migration runs successfully on a fresh schema, drop the `DEFAULT` clause in the `CREATE TABLE` so new inserts must specify a value.
- [x] 2.2 Update `createRunRecord` (in `server/src/run/record.ts` or wherever it lives) to accept `autonomy` and persist it. Reflect the field in the returned `Run` object.
- [x] 2.3 Update `buildPrompt` in `server/src/run/prompt-builder.ts` to accept `(userPrompt: string, autonomy: Autonomy)` and return `` `/start-feature --autonomy=${autonomy} ${userPrompt}` ``. Update `buildPrereqPrompt` is unaffected.
- [x] 2.4 Update `POST /api/runs` in `server/src/run/routes.ts`:
  - Validate `body.autonomy` is one of the four allowed values; respond 400 with a clear error message on missing/invalid.
  - Pass `body.autonomy` to `buildPrompt` and `createRunRecord`.
- [x] 2.5 Add `defaultAutonomy: Autonomy` to the `Project` shape returned by `GET /api/projects/:id`. Read from the project's `.claude/skills/feature-workflow/config.json` under `clarify.defaultAutonomy`. Default to `'balanced'` if the file is missing, unreadable, or the value is not one of the four allowed levels (log a warning for the latter).
- [x] 2.6 Add tests in `server/src/__tests__/`:
  - 400 on `POST /api/runs` without `autonomy`.
  - 400 on `POST /api/runs` with `autonomy: "medium"` (invalid).
  - 201 on `POST /api/runs` with each valid value; verify the prompt the driver receives is `/start-feature --autonomy=<level> <user-prompt>`.
  - `GET /api/runs/:id` returns `autonomy`.
  - `GET /api/projects/:id` returns the correct `defaultAutonomy` when config has a valid value, when config has an invalid value (defaults to `balanced`), and when config is missing (defaults to `balanced`).

## 3. Server: skill-check tightening

- [x] 3.1 Extend `checkFeatureWorkflowSkill` in `server/src/run/skill-check.ts` to reject `SKILL.md` files containing any of:
  - `AskUserQuestion` (literal substring)
  - `Reply \`confirm\`` (the broken 1-syn print-and-pray phrasing)
  - `accept [Enter] or override` (the broken autonomy print-and-pray phrasing)

  Return `{ ok: false, reason: "This repo's feature-workflow uses un-instrumented gate patterns (AskUserQuestion or print-and-pray). Re-run /claudboard-workflow to regenerate it under the current contract." }` on any match.
- [x] 3.2 Add unit tests for `checkFeatureWorkflowSkill`:
  - Returns `ok: true` for a SKILL containing only `mcp__bosch__*` gate emissions.
  - Returns `ok: false` for each of the three proscribed patterns, separately.
  - Returns `ok: false` for the existing "missing `mcp__bosch__`" case (regression).
  - Returns `ok: false` for the existing "missing file" case (regression).

## 4. UI: API client and Kickoff form

- [x] 4.1 Update `api.createRun` in `ui/src/api/client.ts` to accept and send `autonomy: Autonomy` in the request body.
- [x] 4.2 Update `api.getProject` consumers to surface the new `defaultAutonomy` field on the returned `Project`.
- [x] 4.3 Add an autonomy `<fieldset>` to `ui/src/components/Kickoff/Kickoff.tsx`:
  - Four radio inputs: `autopilot`, `balanced`, `guided`, `manual`.
  - State seeded from `project.defaultAutonomy` once the project loads; defaults to `balanced` while loading.
  - Each radio shows the label plus a one-line description (matching the language in the SKILL).
  - Disable submit until the project has loaded (so we don't post with a stale-default autonomy).
  - Include `autonomy` in the `createRun` payload.
- [x] 4.4 Add corresponding styles to `ui/src/components/Kickoff/Kickoff.css`. Match the existing form aesthetic.
- [x] 4.5 Update the Kickoff preview pane to echo the selected autonomy (e.g. `→ autonomy: <span class="teal">balanced</span>`).
- [x] 4.6 Add a Vitest unit test for the autonomy selector: defaults from project config, all four values are submittable, payload includes the selected value.

## 5. UI: Active Run displays the selected autonomy

- [x] 5.1 In `ui/src/components/ActiveRun/ActiveRun.tsx`, display the run's `autonomy` in the telemetry header next to other run metadata (cost, tokens, etc.). Single chip, no actions.

## 6. Skill edit (`craftsphere.cloud`, no proposal in that repo)

This section is the agreed manual edit to the craftsphere skill. Tracked here for visibility; not gated by the app change passing review.

- [x] 6.1 In `/Users/LUP1BG/Documents/BoschProjects/craftsphere.cloud/.claude/skills/feature-workflow/SKILL.md`, delete the entire "Clarification autonomy" prompt section (the block that calls `AskUserQuestion` and falls back to print-and-end-turn). Replace with a parsing rule:

  > Parse `<autonomyLevel>` from the kickoff message's `--autonomy=<level>` flag. The Bosch SDLC driver always emits this flag. If the flag is absent (interactive CLI invocation), fall back to `config.clarify.defaultAutonomy`. If still absent, default to `balanced`. **DO NOT** call `AskUserQuestion` for autonomy. **DO NOT** print a prompt and end the turn. The autonomy choice is resolved before the SKILL runs.

- [x] 6.2 In the Phase 1-syn section, replace the print-and-pray confirmation block:

  ```
  Awaiting your confirmation before I ask the 8 clarification dimensions.
  Reply `confirm` or `correct: <feedback>`.
  ```

  with a `mcp__bosch__clarify_request` call:

  ```
  Call mcp__bosch__clarify_request({
    questions: [
      "<synthesis text>\n\nReply `confirm` to proceed to clarification, or describe corrections to the synthesis."
    ]
  })

  Parse result.answers[0]:
    - exactly "confirm" (case-insensitive, trimmed) → proceed to Phase 1a
    - any other text → integrate as a correction to the synthesis and re-synthesize; loop
    - result.skipped === true → proceed without confirmation (autonomy = autopilot path)
  ```

- [ ] 6.3 Hand-verify by running a feature kickoff against craftsphere through the app: confirm the autonomy chosen at Kickoff is the one the SKILL uses (read the transcript), and confirm the 1-syn confirmation appears in `InterviewPane` and resumes the run on response.

## 7. Documentation and follow-ups

- [x] 7.1 Update `Bosch-sdlc-tool/README.md` to note the new Kickoff autonomy field in the Quickstart "Kick off a feature" step.
- [x] 7.2 File a follow-up ticket: "Update `feature-workflow.template/SKILL.md.template` at `claude-repo-scan` to emit the same autonomy parsing rule and `clarify_request`-based 1-syn confirmation. Without this, every new `/claudboard-workflow` regeneration produces a skill the app will reject." Reference this change.
