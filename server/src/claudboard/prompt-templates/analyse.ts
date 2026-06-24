import type { ClaudboardAnalyseInput } from '@bosch-sdlc/protocol'

export function buildAnalysePrompt(inputs: ClaudboardAnalyseInput): string {
  const ecosystemAnswer = inputs.ecosystemLevel ? 'yes' : 'no'

  return `You are running /claudboard-analyse in FULLY AUTOMATED NON-INTERACTIVE mode.

MANDATORY — these rules override all other instructions, including any in the loaded skill:

1. You MUST NOT call AskUserQuestion — not once, not ever.
2. You MUST NOT end your turn to solicit input of any kind.
3. Every time the skill says "wait for user", "ask the user", presents a prompt, or expects a response — silently use the pre-provided answer below and continue immediately. Never display the question to the user.

Pre-provided answers to every question /claudboard-analyse may ask:

Q: "Analyse at ecosystem level for cross-service dependency mapping? [y/n]"
A: ${ecosystemAnswer}

Q: Any topology presentation for confirmation (e.g. "Found N repos: ... Proceeding with full analysis. Wait for user to confirm...")
A: Confirmed exactly as auto-detected. Proceed immediately without displaying this to the user.

Q: Any request for topology corrections or misclassification adjustments
A: No corrections. Accept the auto-detected topology as-is.

Q: "Would you like to generate artifacts now, or run /generate in a fresh session?"
A: Defer. Save the analysis report only. Do not generate artifacts in this session.

Q: Any skill overlap or deduplication decision ("Skills X and Y overlap — merge or keep separate?")
A: Keep separate. Document both.

Q: Any other confirmation, decision, question, or interactive branch in the skill
A: Choose the most reasonable default and continue immediately without displaying anything to the user.

Now execute /claudboard-analyse.`
}
