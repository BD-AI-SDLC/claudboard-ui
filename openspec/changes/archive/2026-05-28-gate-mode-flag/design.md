## Context

Feature runs launched from the bosch-sdlc UI cannot start on any project. The server's `skill-check.ts` (line 33-39) iterates over three "un-instrumented gate patterns" (`AskUserQuestion`, `Reply \`confirm\``, `accept [Enter] or override`) and rejects any SKILL.md that contains them via a naive `content.includes()`. Claudboard-workflow v3.8.1 generates a SKILL.md that contains `AskUserQuestion` both as documentation (halt mechanics section) and as a fallback clarification mechanism, so every generated SKILL.md is rejected.

The user agreed during exploration that:
- The validation is too blunt — documentary mentions of `AskUserQuestion` are harmless.
- The real guarantee should come from the invocation, not the artifact contents.
- A `--gate=mcp` flag in the prompt gives the agent a hard, parseable instruction to use `mcp__bosch__*` tools exclusively, mirroring the existing `--autonomy=<level>` pattern.
- `skill-check.ts` should verify that the SKILL.md *supports* MCP mode (contains `mcp__bosch__`), not that it *excludes* vanilla mode.

## Goals / Non-Goals

**Goals:**
- Feature runs can start from the UI when the SKILL.md contains both MCP and interactive gate paths (dual-mode).
- The prompt sent by bosch-sdlc includes `--gate=mcp`, forcing the agent onto the MCP path.
- Validation still rejects SKILL.md files that have no `mcp__bosch__` references (old templates or hand-written skills that don't support MCP mode).

**Non-Goals:**
- Changing how the Agent SDK injects the MCP server. `driver.ts` already does `mcpServers: { bosch: mcpServer }` — no change needed.
- Adding a UI control for gate mode. It is always `mcp` when running from the app.
- Modifying the SKILL.md template itself — that's the claudboard companion change.

## Decisions

### D1. Extend `buildPrompt` with `--gate=mcp`

**Choice:** Add `--gate=mcp` to the prompt string in `prompt-builder.ts`, adjacent to the existing `--autonomy` flag.

**Why:** The feature-workflow SKILL.md already parses `--autonomy=<level>` from the invocation message. Adding `--gate=<mode>` follows the same convention. The agent reads this as a hard instruction, not a suggestion.

**Trade-off:** The prompt string is a convention between bosch-sdlc and the SKILL.md template. If the SKILL.md template doesn't parse `--gate`, the flag is ignored and the agent falls back to whatever the template says. This is acceptable because `skill-check.ts` still verifies `mcp__bosch__` presence — a template that doesn't understand `--gate` but has `mcp__bosch__` calls will likely still work, just without the hard guarantee.

### D2. Remove pattern blocklist, keep presence check

**Choice:** Delete the `UNINSTRUMENTED_GATE_PATTERNS` array and the for-loop in `checkFeatureWorkflowSkill`. Keep the `content.includes('mcp__bosch__')` check.

**Why:** The presence check proves the template supports MCP mode. The blocklist was a proxy for "doesn't use vanilla gates" — but in a dual-mode template, vanilla gates are the correct fallback for non-orchestrated invocations. The hard guarantee against vanilla gates is now in the prompt (`--gate=mcp`), not the validation.

### D3. Update test expectations

**Choice:** Integration tests that assert 409 for SKILL.md files containing `AskUserQuestion` should be updated to assert 201 when `mcp__bosch__` is also present (dual-mode). A SKILL.md with only `AskUserQuestion` and no `mcp__bosch__` should still get 409.

## File Map

| File | Change |
|------|--------|
| `server/src/run/prompt-builder.ts` | Add `--gate=mcp` to prompt string |
| `server/src/run/skill-check.ts` | Remove `UNINSTRUMENTED_GATE_PATTERNS` and for-loop |
| `server/src/__tests__/integration.test.ts` | Update skill-check test expectations |
