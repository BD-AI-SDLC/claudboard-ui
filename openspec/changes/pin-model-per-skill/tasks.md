## 1. Pre-implementation spike

- [x] 1.1 Run `claude --model 'claude-opus-4-7[1m]' --print "say hi"` and confirm exit 0
- [x] 1.2 Run `claude --model 'claude-sonnet-4-6[1m]' --print "say hi"` and confirm exit 0
- [x] 1.3 Write a throwaway script that calls `query({ options: { model: 'claude-sonnet-4-6[1m]' }, prompt: 'hi' })` against `@anthropic-ai/claude-agent-sdk` and confirms the SDK accepts the bracketed form
- [x] 1.4 If any of 1.1–1.3 fails, downgrade Sonnet pins to `claude-sonnet-4-6` (and Opus pins to `claude-opus-4-7` if needed) before proceeding; note the final IDs in the PR description

## 2. Protocol: skill→model map

- [x] 2.1 Create `protocol/src/models.ts` exporting `MODELS` const, `SkillKey` type, and `PinnedModel` type as specified in `design.md` §D1
- [x] 2.2 Re-export `MODELS`, `SkillKey`, `PinnedModel` from `protocol/src/index.ts`
- [x] 2.3 Run `npm run typecheck -w protocol` and `npm run build -w protocol`; confirm `dist/models.js` and `dist/models.d.ts` are emitted

## 3. Server CLI path (`runPrereqViaCli`)

- [x] 3.1 Decide canonical key for the workflow generator — per `design.md` R3, use `workflow` (not `claudboard-workflow`). Update `CMD_TO_SLASH` to key on `workflow` and propagate that rename through any caller (`prereq/routes.ts`, `claudboard/launcher.ts`'s `cmdBySkill` map already uses `workflow`/`claudboard-workflow` — align both with `MODELS`)
- [x] 3.2 In `server/src/prereq/cli-runner.ts`, import `MODELS, SkillKey` from `@bosch-sdlc/protocol`
- [x] 3.3 At the top of `runPrereqViaCli`, look up `const model = MODELS[cmd as SkillKey]`; if undefined, call `markFailed` with `"Internal error: no model pinned for "${cmd}""` and return (matches §spec "Unknown skill fails the run")
- [x] 3.4 Insert `'--model', model` into the argv passed to `spawn('claude', [...])` immediately after `'--print'`
- [x] 3.5 Emit one `console.info(`[run ${runId}] model=${model} skill=${cmd}`)` immediately before `spawn(...)`

## 4. Server SDK path (`runFeature` + callers)

- [x] 4.1 In `server/src/run/driver.ts`, change the signature to `runFeature(runId: string, target: string, prompt: string, model: string): Promise<void>`
- [x] 4.2 In the same function, pass `model` into `query({ options: { ..., model } })`
- [x] 4.3 Emit one `console.info(`[run ${runId}] model=${model}`)` immediately before `const { query } = await import(...)` (skill identity is not known here; the caller's log line already names it)
- [x] 4.4 In `server/src/run/routes.ts`, import `MODELS` from `@bosch-sdlc/protocol` and update the `runFeature(...)` call to pass `MODELS.feature` as the fourth argument
- [x] 4.5 In `server/src/claudboard/launcher.ts`, import `MODELS` and pass `MODELS[request.skill]` as the fourth argument to `runFeature(...)`. Verify the three skill keys (`analyse | generate | workflow`) all resolve to a defined model value at compile time (TypeScript exhaustiveness should enforce this via `SkillKey`)
- [x] 4.6 Emit one `console.info(`[run ${recordId}] model=${MODELS[skill]} skill=${skill}`)` in `claudboard/launcher.ts` before invoking `runFeature`; same in `run/routes.ts` with `skill=feature`

## 5. Verification: tests

- [x] 5.1 Add `server/src/prereq/__tests__/cli-runner-model.test.ts` — mock `child_process.spawn`, call `runPrereqViaCli` once per skill key (`analyse | generate | workflow | refresh | techdebt`), assert the captured argv contains `'--model'` followed by `MODELS[key]`
- [x] 5.2 Add `server/src/run/__tests__/driver-model.test.ts` — mock the dynamic import of `@anthropic-ai/claude-agent-sdk` so `query()` is a spy, call `runFeature(runId, target, prompt, 'claude-sonnet-4-6[1m]')`, assert `query` was called with `options.model === 'claude-sonnet-4-6[1m]'`
- [x] 5.3 Add a third test that grep-checks `server/src` for hard-coded `'claude-opus'` / `'claude-sonnet'` literals outside the cost-tracker test fixtures, asserting none exist in production source (matches §spec "Server consumes the map at every invocation site")
- [x] 5.4 Run `npm run test -w server` and confirm all three new tests pass and no existing tests regress

## 6. Verification: typecheck + lint

- [x] 6.1 `npm run typecheck` from repo root passes
- [x] 6.2 `npm run lint` from repo root passes (pre-existing failures only, none introduced)
- [x] 6.3 `npm test` from repo root passes (all workspaces — server 296 pass, UI 231 pass, pre-existing 6 failures unchanged)

## 7. Verification: manual smoke

- [ ] 7.1 Launch the dev stack via the `launch-app` skill
- [ ] 7.2 Trigger one prereq run per CLI-only skill (`refresh`, `techdebt`); confirm server log shows `model=claude-opus-4-7[1m]` line; after completion query `SELECT model FROM phase_costs WHERE run_id = ?` and confirm match
- [ ] 7.3 Trigger one claudboard run per dual-path skill (`analyse`, `generate`, `workflow`) via the launcher; confirm same log + DB check, with models per the pin table
- [ ] 7.4 Trigger one feature workflow run; confirm `model=claude-sonnet-4-6[1m]` in logs and DB

## 8. Wrap up

- [ ] 8.1 Run `openspec validate pin-model-per-skill --strict` and confirm green
- [ ] 8.2 Commit on a `feature/pin-model-per-skill` branch with Conventional Commits message `feat(server): pin Anthropic model per skill`
- [ ] 8.3 Open PR; paste the spike outcome (final model IDs) into the PR body
