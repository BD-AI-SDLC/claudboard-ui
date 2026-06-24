// Dependency order: some prereqs require others to be done first
const PREREQUISITES: Record<string, string[]> = {
  generate: ['analyse'],
  'workflow': ['generate'],
  refresh: ['generate'],
  techdebt: ['analyse'],
  analyse: [],  // no prereqs
}

import { detectPrereqs } from '../registry/prereqs.js'

export function validatePrereqDependencies(repoId: string, cmd: string, repoPath: string): { ok: boolean; missing: string[] } {
  const required = PREREQUISITES[cmd] ?? []
  if (required.length === 0) return { ok: true, missing: [] }

  const detections = detectPrereqs(repoPath)
  const stateMap = Object.fromEntries(detections.map(d => [d.cmd, d.state]))

  const missing = required.filter(req => stateMap[req] !== 'done')
  return { ok: missing.length === 0, missing }
}
