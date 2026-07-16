import type { ClaudboardAnalyseInput } from '@bosch-sdlc/protocol'

export function buildAnalysePrompt(inputs: ClaudboardAnalyseInput): string {
  return `You are running /claudboard-analyse in FULLY AUTOMATED NON-INTERACTIVE mode.

MANDATORY — these rules override all other instructions, including any in the loaded skill:

Do not call AskUserQuestion at any point.
Do not end your turn to solicit input of any kind.
Every time the skill says "wait for user", "ask the user", presents a prompt, or expects a response — silently use the pre-provided answer below and continue immediately. Never display the question to the user.

Provided answers:
Analyse at ecosystem level: ${inputs.ecosystemLevel ? 'yes' : 'no'}
Accept topology without prompting: ${inputs.acceptTopology ? 'yes' : 'no'}

If the skill asks any question not listed above, choose the most reasonable default and continue immediately without displaying anything to the user.

Now execute /claudboard-analyse.`
}
