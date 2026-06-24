## Context

The Bosch SDLC tool drives the generated `feature-workflow` skill in target repos via the Anthropic Agent SDK (`@anthropic-ai/claude-agent-sdk`). The SDK invocation runs headlessly — there is no TTY, no interactive user attached to the SDK process. Every "pause" point in the workflow must be a typed `mcp__bosch__*` tool call that this app's in-process MCP server intercepts, opens a deferred for, surfaces in the UI, resolves via REST, and resumes. The `workflow-instrumentation` spec already codifies this: `mcp__bosch__clarify_request` is the single mechanism for the orchestrator to ask the user something mid-run, and four specific sites in the SKILL template are required to use it.

The generated SKILL in `craftsphere.cloud` violates this contract at two sites:

1. **The autonomy gate** (early Phase 1-pre). The SKILL calls `AskUserQuestion` to pick between `autopilot` / `balanced` / `guided` / `manual`. In the `sdk-cli` entrypoint, `AskUserQuestion` returns an empty answer string immediately (there's no human attached to receive the prompt), and the orchestrator interprets the empty answer as "default accepted". The autonomy level is silently `balanced` regardless of intent.
2. **The Phase 1-syn synthesis confirmation gate.** The SKILL prints `"Awaiting your confirmation before I ask the 8 clarification dimensions. Reply \`confirm\` or \`correct: <feedback>\`."` and ends the turn. In a TTY this would pause for a follow-up user message; in a headless SDK run, end-of-turn terminates the entire query. The 2026-05-26 PLAT-26374 run exited at this prompt after 468 seconds, never reaching the spec+plan gate.

The user has separately decided three things during exploration:

- **Autonomy is required at kickoff.** No mid-run choice, no app-level default. The Kickoff form collects it; the server validates it; the run prompt carries it.
- **The default for the Kickoff radio comes from the project's `.claude/skills/feature-workflow/config.json` `clarify.defaultAutonomy`.** Per-repo, not per-user.
- **The 1-syn synthesis confirmation is an inline chat element, not part of the formal Phase 1d gate.** It uses the existing `clarify_request` plumbing, which already renders in `InterviewPane`.

## Goals / Non-Goals

**Goals:**

- The autonomy level a feature run uses is exactly the one the user picked in the Kickoff form. There is no path by which a run silently defaults to `balanced` (or any other value) without the user having selected it.
- The Phase 1-syn synthesis confirmation pauses the run in the same way Phase 1a clarifications do today: a typed `mcp__bosch__clarify_request` call, a `paused-gate` status, `InterviewPane` for response, REST resolution, resume.
- An older skill that still contains `AskUserQuestion` or print-and-end-turn gate patterns is rejected at kickoff with a clear "re-generate" message, before any cost is incurred.
- The existing four `clarify_request` sites and the Phase 1d `gate_request` site continue to work unchanged.

**Non-Goals:**

- Updating the skill **template** at `claude-repo-scan/skills/claudboard-workflow/references/feature-workflow.template/SKILL.md.template`. The user explicitly scoped the skill change to `craftsphere.cloud` only. The template update is recorded as a follow-up.
- Per-user autonomy preferences, account-level defaults, or any UI for editing the project's `defaultAutonomy`. The kickoff radio reads `config.json`; if the user wants a different default they edit the file.
- Persisting partial Kickoff form state. The autonomy radio resets to the project default on every visit; no draft preservation.
- Mid-run autonomy escalation (e.g. "I picked `autopilot` but want to switch to `manual` now"). Not a real user need — autonomy is a kickoff knob.
- Migrating in-flight runs created before this change. The additive migration backfills `autonomy = 'balanced'` for existing rows; that is exactly the value those runs effectively used, so the backfill is honest.
- Solving the broader "the skill is generated and will regress on next `/claudboard-workflow`" problem in this change. Tracked separately.

## Decisions

### D1. Autonomy is carried in the initial prompt as a flag, not via env / SDK options / MCP tool

**Choice:** The initial prompt becomes `"/start-feature --autonomy=<level> <user-prompt>"`. The SKILL parses the flag from the user message.

**Why:**

- The existing `run-driver` spec fixes the run topology entirely on the initial prompt: nothing else flows from kickoff into the SKILL. Keeping that single channel preserves the rest of the architecture untouched.
- An env var (e.g. `CLAUDE_AUTONOMY=balanced`) is invisible to the SKILL prose and would force every contributor to know about an out-of-band variable. The flag is in the user's own message, where the SKILL already looks.
- A dedicated `mcp__bosch__set_autonomy` tool call would put the value on the SKILL's read path, but it would also require the SKILL to make a tool call before any other work — adding a round-trip for a value that is constant for the entire run.
- The flag is a recognised shape (POSIX-style `--key=value`) that is trivial to parse with a regex and impossible to confuse with the user's free-text prompt.

**Alternatives considered:**

- **Env var (`CLAUDE_AUTONOMY`).** Rejected as out-of-band; SKILL contributors would have no on-page evidence that it exists.
- **System prompt prepend.** The SDK supports `systemPrompt` options, but using it for a per-run value blurs the line between system context and per-run config; future per-run values would pile up there.
- **MCP tool (`mcp__bosch__set_autonomy`).** Rejected — adds a tool call for a value that never changes. The constant-per-run cost is real on a system that's already chatty.

### D2. The autonomy radio default comes from the project's `config.json`, fetched at Kickoff mount

**Choice:** The Kickoff component calls `api.getProject(projectId)` and reads `defaultAutonomy` from the project record (which the server reads from `.claude/skills/feature-workflow/config.json` under `clarify.defaultAutonomy`). The radio is initialised to that value; the user can override.

**Why:**

- Keeps the per-repo nature of the setting honest. A repo whose team prefers `guided` should have the Kickoff form land on `guided` by default.
- Avoids inventing a second source of truth (app-level setting). One source: the repo's own config.
- The `config.json` is already part of the skill-generation contract — every generated skill has it.

**Edge cases:**

- Project's `config.json` missing or `clarify.defaultAutonomy` absent → default to `'balanced'` in the UI (the SKILL fallback is the same). The Kickoff form shows the radio set to `balanced` and the user can change it.
- Project's `config.json` contains an invalid value (e.g. `"medium"`) → server normalises to `'balanced'`, logs a warning. UI shows `balanced` selected.

### D3. The Phase 1-syn synthesis confirmation uses `clarify_request`, not a new gate kind

**Choice:** The Phase 1-syn block in the SKILL calls `mcp__bosch__clarify_request({ questions: [<synthesis-text + "\n\nReply `confirm` to proceed, or describe corrections."> ] })`. The user response (`confirm` or freeform correction text) is the `answers[0]` value the SKILL parses to decide whether to proceed to Phase 1a or to revise.

**Why over a new `synthesis-confirm` gate kind:**

- `clarify_request` already pauses the run, opens a deferred, broadcasts `gate-request`, transitions to `paused-gate`, and renders in `InterviewPane`. A new gate kind would duplicate every one of those mechanics for one site.
- The single-question shape fits naturally — `InterviewPane` already handles single-question gates (it just shows one card with no Prev/Next).
- The "answers vs skipped" resolution union in the resolve route already covers both responses we need: `{ answers: ["confirm"] }` to proceed; `{ answers: ["<corrections>"] }` to revise; `{ skipped: true }` for users who want to skip the synthesis check entirely (`autopilot` does not block here; `balanced` and below do).

**Why not part of the formal Phase 1d gate:**

- The README and the user's mental model both say "exactly one human gate" for spec+plan approval. Folding synthesis into that gate confuses two distinct moments (early sanity check vs. final approval).
- Synthesis happens before clarification questions are even asked; spec+plan happens after both. They are not the same decision point.

### D4. `checkFeatureWorkflowSkill` rejects un-instrumented gate patterns at kickoff

**Choice:** Extend the existing skill-check to look for three patterns and reject (HTTP 409 with a "re-generate" reason) if any are found in `SKILL.md`:

1. `AskUserQuestion` (any occurrence — the tool name itself is forbidden in the SKILL surface)
2. `Reply \`confirm\`` (the literal print-and-pray prompt the broken 1-syn block uses)
3. Print-and-end-turn patterns for human input — detected by searching for the phrase `accept [Enter] or override` from the legacy autonomy prompt; in future, this regex set may grow

**Why:**

- We already have a working precedent: the skill-check already rejects skills missing `mcp__bosch__`. The extension adds two more substring checks; same code path, same error UX.
- Catching the bad pattern at kickoff is the only place we can prevent the cost incident from recurring. Once the run starts, the SKILL is in control and there's no harness intervention available.
- A pure string match is the right level of complexity. The SKILL is markdown; full parsing would be overkill, and the proscribed patterns are unambiguous strings.

**Edge cases:**

- A SKILL that mentions `AskUserQuestion` in a documentation aside (e.g., "this skill does NOT use `AskUserQuestion`") will be rejected. Acceptable false positive — the SKILL author should not write the tool name at all; the contract is "never call it". A code-fence-skipping parser is unnecessary complexity for a content channel under our own control.
- A SKILL that uses different print-and-pray phrasing (e.g., `Reply \`yes\` to proceed`) will pass this check. The current pattern set covers the known offenders; future variants can extend the regex set.

### D5. Persisted runs gain `autonomy` as `TEXT NOT NULL`; existing rows backfill to `'balanced'`

**Choice:** Schema migration adds `autonomy TEXT NOT NULL DEFAULT 'balanced'` to the `runs` table; the `DEFAULT` clause backfills existing rows. The `DEFAULT` is removed after migration so new inserts must specify a value (enforcing the protocol-level requirement at the DB level too).

**Why:**

- All historical runs used `balanced` (the silent default). Backfilling to `balanced` is honest, not invented data.
- Two-step migration (add with default → drop default) is the SQLite idiom for "required column on a populated table".
- Belt-and-braces enforcement: the protocol requires it, the server validates it, the DB constraint catches anyone who bypasses the validator (tests, manual inserts).

## Risks

- **Skill version skew during rollout.** A user updates the app, opens an existing project, hits Kickoff, and gets the new "re-generate" rejection from the extended skill-check. This is the *correct* behaviour but worth a one-line note in the rejection message: "This update added a new skill contract. Re-run `/claudboard-workflow` to regenerate."
- **Template not updated yet.** Every fresh `/claudboard-workflow` regeneration (in this project or others) still emits the broken patterns until the template change lands. The kickoff-time rejection mitigates the cost, but users will see the "re-generate" loop on every new repo until the template is fixed. Track as a high-priority follow-up.
- **`InterviewPane` UX for one long question.** The Phase 1-syn synthesis can be 500+ words. `InterviewPane` currently scrolls the question pane; verify the single-question rendering is comfortable for long content. If not, a small CSS pass is in scope.
