## 1. Add `--gate=mcp` to prompt builder

- [x] 1.1 In `server/src/run/prompt-builder.ts`, update `buildPrompt()` to include `--gate=mcp` in the returned prompt string: `Start feature --autonomy=${autonomy} --gate=mcp: ${userPrompt}`.

## 2. Relax skill-check validation

- [x] 2.1 In `server/src/run/skill-check.ts`, delete the `UNINSTRUMENTED_GATE_PATTERNS` array (lines 9-13).
- [x] 2.2 Delete the for-loop that checks `content.includes(pattern)` and returns the "un-instrumented gate patterns" error (lines 33-39).
- [x] 2.3 Keep the file-exists check (lines 18-23) and the `mcp__bosch__` presence check (lines 25-31) unchanged.

## 3. Update integration tests

- [x] 3.1 In `server/src/__tests__/integration.test.ts`, find the test(s) that assert 409 rejection for SKILL.md files containing `AskUserQuestion`. Update them: a SKILL.md containing both `AskUserQuestion` and `mcp__bosch__gate_request` should now get 201.
- [x] 3.2 Add or keep a test that a SKILL.md with only `AskUserQuestion` (no `mcp__bosch__`) still gets 409 (caught by the existing `mcp__bosch__` presence check).
- [x] 3.3 Run `node --experimental-vm-modules ../node_modules/.bin/jest` from `server/` and confirm all tests pass.

## 4. Build and typecheck

- [x] 4.1 Run `npm run build` from repo root. Confirm clean build.
- [x] 4.2 Run `npm run typecheck` from repo root. Confirm no errors.
