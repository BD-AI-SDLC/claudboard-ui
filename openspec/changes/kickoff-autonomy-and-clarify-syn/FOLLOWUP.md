# Follow-up: update the `feature-workflow` skill template

This change edits the **generated** `feature-workflow/SKILL.md` in
`craftsphere.cloud` only. The **template** that produces those generated
SKILLs still emits the broken patterns. Until the template is updated,
every fresh `/claudboard-workflow` regeneration (in this project or any
other) produces a SKILL that the extended `checkFeatureWorkflowSkill`
will reject at kickoff.

## What to do

Update the template at
`/Users/LUP1BG/Documents/BoschProjects/claude-repo-scan/skills/claudboard-workflow/references/feature-workflow.template/SKILL.md.template`
with the same two edits this change applied to the craftsphere SKILL:

1. **Rewrite the "Halt mechanics" section** so `mcp__bosch__clarify_request`
   is the only allowed pause mechanism. Remove all references to
   `AskUserQuestion` and to print-and-end-turn as fallbacks.
2. **Rewrite the "Clarification autonomy" section** so the orchestrator
   parses `--autonomy=<level>` from the kickoff message and never prompts
   for autonomy. Falls back to `config.clarify.defaultAutonomy` and then
   to `balanced`.
3. **Rewrite the Phase 1-syn confirmation block** to call
   `mcp__bosch__clarify_request` with the synthesis text instead of
   printing `Reply \`confirm\`` and ending the turn.

Reference the edited craftsphere SKILL as a working example:
`/Users/LUP1BG/Documents/BoschProjects/craftsphere.cloud/.claude/skills/feature-workflow/SKILL.md`.

## Why it's not in this change

The user explicitly scoped the SKILL edit to `craftsphere.cloud` only
(no proposal in that repo) and asked for the app-side change to land in
the Bosch SDLC tool. Updating the template is a third repo
(`claude-repo-scan`) with its own openspec lifecycle and is best treated
as a separate change so its review and tests live alongside the template
itself.

## What the kickoff guard buys us in the meantime

The extended `checkFeatureWorkflowSkill` (new in this change) rejects
any SKILL containing `AskUserQuestion`, `Reply \`confirm\``, or
`accept [Enter] or override` with a 409 and a clear "re-generate" message.
That means the cost incident this change responds to (the 2026-05-26
PLAT-26374 run that burned $7.45) cannot recur — runs against
non-compliant SKILLs are refused before any `query()` call.

What the user *will* hit until the template lands: every fresh
`/claudboard-workflow` regeneration produces a non-compliant SKILL,
the next kickoff against that repo will get the 409, and the user has
to manually re-apply the craftsphere-style edits before kickoff works.
