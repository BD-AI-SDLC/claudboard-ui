import type { Autonomy } from '@bosch-sdlc/protocol'

export function buildPrompt(userPrompt: string, autonomy: Autonomy): string {
  // Plain-text prefix (no leading slash) so the Agent SDK does not interpret
  // this as a slash-command invocation. The SKILL parses `--autonomy=<level>`
  // from anywhere in the message.
  return `Start feature --autonomy=${autonomy} --gate=mcp: ${userPrompt}`
}
