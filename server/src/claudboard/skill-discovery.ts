import { resolveClaudboard } from '../cost/resolver.js'

const INSTALL_HINT =
  'Install the claudboard plugin via the Claude Code marketplace'

export interface ClaudboardAvailability {
  installed: boolean
  installHint?: string
}

export function isClaudboardInstalled(): ClaudboardAvailability {
  const install = resolveClaudboard()
  if (install) return { installed: true }
  return { installed: false, installHint: INSTALL_HINT }
}
