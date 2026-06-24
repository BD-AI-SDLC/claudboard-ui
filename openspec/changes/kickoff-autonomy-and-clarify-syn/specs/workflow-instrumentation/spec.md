## ADDED Requirements

### Requirement: Generated SKILL parses autonomy from the `--autonomy` kickoff flag

The `feature-workflow/SKILL.md` template SHALL include explicit prose instructing the orchestrator to resolve `<autonomyLevel>` from the kickoff message at the very start of the run, before any other action. The resolution rule SHALL be:

1. Parse the kickoff user message for the substring matching the regex `--autonomy=(autopilot|balanced|guided|manual)`. If present, `<autonomyLevel>` is that captured value.
2. If the flag is absent (e.g. interactive CLI invocation with no driver), fall back to `config.clarify.defaultAutonomy` from the SKILL's `config.json`.
3. If still absent or invalid, default to `balanced`.

The template SHALL explicitly forbid two patterns at the autonomy-resolution site:

- `AskUserQuestion` (or any text describing a call to it) — the tool is unavailable in headless SDK runs and silently returns empty answers.
- Printing a prompt line (e.g. `Clarification autonomy: ... accept [Enter] or override`) and ending the turn — end-of-turn terminates a headless SDK run rather than pausing it.

The template SHALL cross-reference the broader "Human input" subsection that mandates `mcp__bosch__clarify_request` as the sole orchestrator-to-user channel; autonomy resolution is one specific case of that rule (resolved at kickoff rather than mid-run, but still subject to the no-`AskUserQuestion`, no-print-and-end-turn prohibitions).

The template SHALL note that the Bosch SDLC driver always populates the `--autonomy` flag, so the fallback paths exist only for ad-hoc interactive CLI invocations.

#### Scenario: Generated SKILL parses the autonomy flag

- **GIVEN** the user runs `/claudboard-workflow` in a repo
- **WHEN** the generated `feature-workflow/SKILL.md` is inspected
- **THEN** the autonomy section instructs the orchestrator to parse `--autonomy=<level>` from the kickoff message
- **AND** the section lists the four allowed values explicitly
- **AND** the section describes the fallback chain (kickoff flag → `config.clarify.defaultAutonomy` → `balanced`)

#### Scenario: Generated SKILL forbids `AskUserQuestion` for autonomy

- **GIVEN** a generated `feature-workflow/SKILL.md`
- **WHEN** the autonomy section is inspected
- **THEN** the section explicitly forbids calling `AskUserQuestion` for autonomy
- **AND** the section explicitly forbids printing the legacy `accept [Enter] or override` prompt

### Requirement: Generated SKILL Phase 1-syn confirmation uses clarify_request

The `feature-workflow/SKILL.md` template's Phase 1-syn (Synthesis) section SHALL replace the legacy print-and-pray confirmation block with a `mcp__bosch__clarify_request` call.

The block to replace is the prose pattern:

```
Awaiting your confirmation before I ask the N clarification dimensions.
Reply `confirm` or `correct: <feedback>`.
```

(Or any structurally equivalent print-then-end-turn phrasing.)

The replacement SHALL:

1. Construct a single-question payload containing the synthesis text followed by an instruction line: `"Reply \`confirm\` to proceed to clarification, or describe corrections to the synthesis."`
2. Call `mcp__bosch__clarify_request({ questions: [<that combined string>] })`.
3. Parse `result.answers[0]`:
   - The literal string `confirm` (case-insensitive, trimmed) → proceed to Phase 1a.
   - Any other non-empty string → treat as a correction to the synthesis: re-synthesize with the correction integrated, then call `clarify_request` again with the revised synthesis. Loop until `confirm` is received.
4. On `result.skipped === true` → proceed without confirmation (this is the `autopilot` path; the user has opted out of the synthesis check).

The template SHALL note that this Phase 1-syn call is the **fifth** site where `clarify_request` is used (alongside the four sites already enumerated: Phase 1a, Phase 1a-ws, Phase 3 blocker, Phase 5a/b escalation). The "Quick reference" table at the bottom of the template SHALL list this site.

The template SHALL include explicit guardrails forbidding the legacy patterns at the Phase 1-syn site:

- `AskUserQuestion` MUST NOT appear.
- `` Reply `confirm` `` as a standalone printed line (without a wrapping `clarify_request` call) MUST NOT appear.
- "End the turn and wait for the user's reply" instructions MUST NOT appear.

#### Scenario: Generated SKILL Phase 1-syn invokes clarify_request

- **GIVEN** the user runs `/claudboard-workflow` in a repo
- **WHEN** the generated `feature-workflow/SKILL.md` is inspected at the Phase 1-syn section
- **THEN** the section contains an explicit `mcp__bosch__clarify_request` call carrying the synthesis text
- **AND** the section describes parsing `result.answers[0]` for `confirm` vs. correction text
- **AND** the section describes the `result.skipped === true` branch as the autopilot path

#### Scenario: Generated SKILL Phase 1-syn forbids print-and-pray

- **GIVEN** a generated `feature-workflow/SKILL.md`
- **WHEN** the Phase 1-syn section is inspected
- **THEN** the section does NOT contain the substring `` Reply `confirm` `` as a standalone printed line
- **AND** the section does NOT contain instructions to "end the turn and wait" for user input

#### Scenario: Quick reference table lists the fifth clarify_request site

- **GIVEN** a generated `feature-workflow/SKILL.md`
- **WHEN** the "Quick reference" table at the bottom of the template is inspected
- **THEN** the table includes a row for Phase 1-syn with the "Gate" column mentioning `clarify_request`

### Requirement: Server skill-validation enforces the no-`AskUserQuestion` and no-print-and-pray contract at kickoff

The Bosch SDLC server's `checkFeatureWorkflowSkill` function (`server/src/run/skill-check.ts`) SHALL reject any target repo whose `SKILL.md` contains any of the proscribed legacy patterns, before the run is allowed to start. This enforcement is the runtime backstop for the template requirements above — even if a template change is missed or a SKILL is hand-edited to reintroduce the legacy pattern, the kickoff guard prevents the cost incident from recurring.

The proscribed patterns (substring match, no parsing) are:

- `AskUserQuestion`
- `` Reply `confirm` `` (the legacy Phase 1-syn print-and-pray prompt)
- `accept [Enter] or override` (the legacy autonomy print-and-pray prompt)

A SKILL containing any of these SHALL be rejected with HTTP 409 and a `reason` of:

> This repo's feature-workflow uses un-instrumented gate patterns. Re-run /claudboard-workflow to regenerate it under the current contract.

The rejection SHALL occur before any `query()` call is made and before any `Run` record is created — no API or compute cost SHALL be incurred for a non-compliant SKILL.

#### Scenario: Kickoff rejects SKILL containing `AskUserQuestion`

- **GIVEN** a target repo whose `SKILL.md` contains the substring `AskUserQuestion` anywhere
- **WHEN** the user submits the Kickoff form
- **THEN** the server responds 409 with the "un-instrumented gate patterns" reason
- **AND** the UI surfaces the reason verbatim, with a link or instruction to re-run `/claudboard-workflow`
- **AND** no run is started

#### Scenario: Kickoff rejects SKILL containing the legacy 1-syn print-and-pray prompt

- **GIVEN** a target repo whose `SKILL.md` contains the substring `` Reply `confirm` ``
- **WHEN** the user submits the Kickoff form
- **THEN** the server responds 409 with the "un-instrumented gate patterns" reason

#### Scenario: Kickoff rejects SKILL containing the legacy autonomy print-and-pray prompt

- **GIVEN** a target repo whose `SKILL.md` contains the substring `accept [Enter] or override`
- **WHEN** the user submits the Kickoff form
- **THEN** the server responds 409 with the "un-instrumented gate patterns" reason
