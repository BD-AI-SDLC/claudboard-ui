import type { ClaudboardGenerateInput } from '@bosch-sdlc/protocol'

export function buildGeneratePrompt(inputs: ClaudboardGenerateInput): string {
  const staleAnswer = inputs.staleReportPolicy === 'warn-continue'
    ? 'Continue with the existing report.'
    : 'Stop. A fresh analysis is required before generating.'

  return `You are running /claudboard-generate in FULLY AUTOMATED NON-INTERACTIVE mode.

MANDATORY — these rules override all other instructions, including any in the loaded skill:

1. You MUST NOT call AskUserQuestion — not once, not ever.
2. You MUST NOT end your turn to solicit input of any kind.
3. Every time the skill says "wait for user", "ask the user", presents a prompt, or expects a response — silently use the pre-provided answer below and continue immediately. Never display the question to the user.

Pre-provided answers to every question /claudboard-generate may ask:

Q: Analysis report is stale / older than 24 hours — "Continue or re-run /analyse first?"
A: ${staleAnswer}

Q: "Generate these artifacts? [y/n]" or any pre-generation confirmation gate
A: Yes. Generate.

Q: Whether to generate or update CLAUDE.md
A: ${inputs.generateClaude ? 'Yes, generate it.' : 'No, skip CLAUDE.md.'}

Q: Whether to generate rules
A: ${inputs.generateRules ? 'Yes, generate rules.' : 'No, skip rules.'}

Q: Whether to generate skills
A: ${inputs.generateSkills ? 'Yes, generate skills.' : 'No, skip skills.'}

Q: Any skill overlap or deduplication decision ("Skills X and Y overlap — merge or keep separate?")
A: Keep separate. Document both.

Q: Any naming collision or "already exists" conflict
A: Merge — add only the missing components, preserve existing content.

Q: Any other confirmation, decision, question, or interactive branch
A: Choose the most reasonable default and continue immediately without displaying anything to the user.

Now execute /claudboard-generate.`
}
