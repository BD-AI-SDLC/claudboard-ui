## 1. Protocol: input schemas

- [x] 1.1 Audit `claudboard-analyse/SKILL.md` and enumerate every question it asks; record the exhaustive list (choice fields, free-form fields, defaults)
- [x] 1.2 Audit `claudboard-generate/SKILL.md` and enumerate every question it asks
- [x] 1.3 Audit `claudboard-workflow/SKILL.md` + its `references/tracker-config-prompts.md` and `references/repo-config-prompts.md`; enumerate every question and field
- [x] 1.4 Define `claudboardAnalyseInputSchema` (Zod) in `protocol/src/claudboard/analyse.ts` covering all fields from 1.1
- [x] 1.5 Define `claudboardGenerateInputSchema` (Zod) in `protocol/src/claudboard/generate.ts` covering all fields from 1.2
- [x] 1.6 Define `claudboardWorkflowInputSchema` (Zod) in `protocol/src/claudboard/workflow.ts` covering all fields from 1.3, with branch validation (when `tracker = "jira"` the jira fields are required, etc.)
- [x] 1.7 Define shared `stubbableString = z.union([z.string().min(1), z.literal("__stub__")])` helper for free-form fields
- [x] 1.8 Define top-level `claudboardLaunchRequest = z.discriminatedUnion("skill", [...])` in `protocol/src/claudboard/index.ts` and re-export from `protocol/src/index.ts`
- [x] 1.9 Build `protocol/` and verify generated types compile

## 2. Database: additive migration

- [x] 2.1 In `server/src/db.ts`, add a column-presence-guarded `ALTER TABLE runs ADD COLUMN kind TEXT DEFAULT 'feature'` migration following the existing `PRAGMA table_info` pattern
- [x] 2.2 Add a unit test that runs the migration against an in-memory database built from the previous schema and asserts existing rows report `kind = 'feature'`

## 3. Server: claudboard module

- [x] 3.1 Create `server/src/claudboard/` with `routes.ts`, `launcher.ts`, `skill-discovery.ts`, `prompt-templates/` directory
- [x] 3.2 Implement `skill-discovery.ts#isClaudboardInstalled()` that stats `~/.claude/plugins/marketplaces/claudboard/` and returns boolean + install-hint string
- [x] 3.3 Implement `prompt-templates/analyse.ts` that takes a validated `claudboardAnalyseInputSchema` value and returns the full prompt string (preamble + answers block + skill invocation line)
- [x] 3.4 Implement `prompt-templates/generate.ts` (same pattern)
- [x] 3.5 Implement `prompt-templates/workflow.ts` (same pattern; render stub sentinels as `[TODO: <FIELD_NAME>]`)
- [x] 3.6 Implement `launcher.ts#launchClaudboardRun(skill, inputs)` that creates a run record with `kind = 'claudboard-<skill>'`, builds the prompt via the appropriate template, and invokes the existing run driver
- [x] 3.7 Implement `routes.ts` exporting an Express router with `POST /api/claudboard/run`: validate body with `claudboardLaunchRequest`, run skill-discovery check, reject `workspace-init`/`workspace-link` with 400, call `launchClaudboardRun`, respond with 201 + `{ runId }`
- [x] 3.8 Register the claudboard router in `server/src/app.ts`
- [x] 3.9 Add `GET /api/claudboard/availability` returning `{ installed: boolean, installHint?: string }` so the UI can pre-flight the launcher buttons

## 4. Server: tests

- [x] 4.1 Add `server/src/claudboard/__tests__/routes.test.ts` covering: valid launch returns 201, missing field returns 400 with Zod error, unknown skill returns 400, `workspace-init`/`workspace-link` rejected with 400, missing plugin returns 412
- [x] 4.2 Add `server/src/claudboard/__tests__/prompt-templates.test.ts` covering: rendered prompts include the non-interactive preamble, all submitted fields appear in the "Provided answers" block, stub sentinels render as TODO placeholders
- [x] 4.3 Add `server/src/claudboard/__tests__/launcher.test.ts` covering: run record is created with `kind` set, run is registered with the driver, returned `runId` matches the record

## 5. UI: API client

- [x] 5.1 Add `ui/src/api/claudboard.ts` with `launchClaudboardRun(skill, inputs)` and `fetchClaudboardAvailability()` methods using the existing fetch utility
- [x] 5.2 Export both from `ui/src/api/index.ts` (or equivalent barrel)

## 6. UI: launcher forms

- [x] 6.1 Create `ui/src/components/claudboard/AnalyseForm.tsx` rendering all fields from the analyse schema with client-side Zod validation
- [x] 6.2 Create `ui/src/components/claudboard/GenerateForm.tsx` (same pattern)
- [x] 6.3 Create `ui/src/components/claudboard/WorkflowForm.tsx` (same pattern; conditionally renders tracker/repo subsections; per-free-form-field "stub" checkbox that disables the input and submits `"__stub__"`)
- [x] 6.4 Create `ui/src/components/claudboard/ClaudboardLauncher.tsx` that renders three buttons (Analyse / Generate / Workflow), opens the appropriate modal form, and submits via the API client
- [x] 6.5 On mount, `ClaudboardLauncher` calls `fetchClaudboardAvailability()` and disables all buttons with a tooltip if the plugin is missing
- [x] 6.6 On successful launch, close the modal and navigate to the live run view for the returned `runId`

## 7. UI: integration

- [x] 7.1 Identify the appropriate dashboard screen(s) for the launcher (current candidates: project overview, repo view) and place `<ClaudboardLauncher />` there
- [x] 7.2 Add vitest coverage in `ui/src/components/claudboard/__tests__/` for each form: valid submit calls API, invalid field shows inline error, stub checkbox swaps value to sentinel

## 8. Documentation & verification

- [x] 8.1 Update `README.md` (or equivalent) with a short section on launching claudboard skills from the dashboard, including the plugin installation prerequisite
- [x] 8.2 Run `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test` from repo root and verify all pass
- [ ] 8.3 Manual smoke test: launch each of analyse/generate/workflow with valid inputs against a real claudboard plugin installation and confirm the run completes without emitting any `AskUserQuestion` events (inspect the event log)
  Note: lint pre-existing violations (sidebar, dashboard, kickoff CSS) fail lint independent of this change — confirmed via git stash.

## 9. Follow-up (deferred)

- [ ] 9.1 Audit `claudboard-techdebt/SKILL.md` and add its schema + template + form
- [ ] 9.2 Audit `claudboard-refresh/SKILL.md` and add its schema + template + form
- [ ] 9.3 Evaluate whether `techdebt` and `refresh` need a stage-then-apply mode rather than auto-approve
