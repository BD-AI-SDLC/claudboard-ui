## Prompt Builder

### `buildPrompt(userPrompt, autonomy)`

**Current output:**
```
Start feature --autonomy=<level>: <userPrompt>
```

**New output:**
```
Start feature --autonomy=<level> --gate=mcp: <userPrompt>
```

The `--gate=mcp` flag is always present. There is no UI control to change it — all feature runs launched from the bosch-sdlc app are orchestrated.

---

## Skill Check

### `checkFeatureWorkflowSkill(repoPath)`

**Check 1 — File exists:**
- Path: `<repoPath>/.claude/skills/feature-workflow/SKILL.md`
- Fail: `{ ok: false, reason: "This repo has no feature-workflow skill. Run /claudboard-workflow to generate one." }`

**Check 2 — MCP support:**
- Condition: `content.includes('mcp__bosch__')`
- Fail: `{ ok: false, reason: "This repo's feature-workflow was generated with an older template. Re-run /claudboard-workflow to update." }`

**Check 3 — REMOVED:**
- The `UNINSTRUMENTED_GATE_PATTERNS` array and the for-loop that rejects `AskUserQuestion`, `Reply \`confirm\``, and `accept [Enter] or override` are deleted. These patterns are valid content in a dual-mode SKILL.md.

**Pass:** `{ ok: true }`
