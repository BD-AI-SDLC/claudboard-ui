import { execFileSync } from 'node:child_process'

export function checkClaudeCodePrecondition(): void {
  try {
    execFileSync('claude', ['--version'], { timeout: 5_000, stdio: 'ignore' })
  } catch {
    console.error(
      'bosch-sdlc requires Claude Code. Install from https://claude.com/claude-code, then run bosch-sdlc again.'
    )
    process.exit(1)
  }
}
