import type { PrereqRecord } from '@bosch-sdlc/protocol'

export type VisualState = 'done' | 'done-imported' | 'stale' | 'running' | 'next' | 'locked' | 'missing'

// Mirror of server/src/prereq/validators.ts — keep in sync
export const FOUNDATION_DEPS: Record<string, string[]> = {
  'analyse': [],
  'generate': ['analyse'],
  'workflow': ['generate'],
}

export const MAINTENANCE_DEPS: Record<string, string[]> = {
  'refresh': ['generate'],
  'techdebt': ['analyse'],
}

export interface FoundationOpDef {
  id: string
  title: string
  cmd: string
  desc: string
  step: number
}

export interface MaintenanceOpDef {
  id: string
  title: string
  cmd: string
  desc: string
  icon: string
}

export const FOUNDATION_OPS: FoundationOpDef[] = [
  { id: 'analyse', title: 'Analyse', cmd: '/claudboard-analyse', desc: 'Read-only scan: patterns, anti-patterns, workflow signals, stack detection.', step: 1 },
  { id: 'generate', title: 'Generate', cmd: '/claudboard-generate', desc: 'Render CLAUDE.md, rules with paths frontmatter, full-scope skills.', step: 2 },
  { id: 'workflow', title: 'Feature-workflow', cmd: '/claudboard-workflow', desc: 'Generate the .claude/skills/feature-workflow/ orchestrator skill (agents, scripts, config.json).', step: 3 },
]

export const MAINTENANCE_OPS: MaintenanceOpDef[] = [
  { id: 'refresh', title: 'Refresh', cmd: '/claudboard-refresh', desc: 'Updates rules and skills to match recent code changes. Run when the codebase has drifted.', icon: '↻' },
  { id: 'techdebt', title: 'Tech debt', cmd: '/claudboard-techdebt', desc: 'Deep tech debt analysis. Module-grouped, ticket-ready report with severity, effort, and fix suggestions.', icon: '⚠' },
]

function depsAreSatisfied(deps: string[], allPrereqs: Record<string, PrereqRecord>): boolean {
  return deps.every(dep => allPrereqs[dep]?.state === 'done')
}

export function deriveVisualState(
  prereq: PrereqRecord | undefined,
  allPrereqs: Record<string, PrereqRecord>,
  deps: string[],
  isRunning: boolean,
): VisualState {
  if (isRunning) return 'running'
  if (!prereq || prereq.state === 'missing') {
    return depsAreSatisfied(deps, allPrereqs) ? 'next' : 'locked'
  }
  if (prereq.state === 'done') {
    return prereq.lastRun === null ? 'done-imported' : 'done'
  }
  if (prereq.state === 'stale') return 'stale'
  return 'missing'
}

export interface DerivedOp<T> {
  def: T
  visualState: VisualState
}

export function deriveFoundationStates(
  prereqs: Record<string, PrereqRecord>,
  running: Record<string, boolean>,
): DerivedOp<FoundationOpDef>[] {
  let foundNext = false
  return FOUNDATION_OPS.map(def => {
    const prereq = prereqs[def.id]
    const isRunning = running[def.id] ?? false

    if (isRunning) {
      return { def, visualState: 'running' as VisualState }
    }

    if (prereq?.state === 'done') {
      return { def, visualState: (prereq.lastRun === null ? 'done-imported' : 'done') as VisualState }
    }

    if (prereq?.state === 'stale') {
      return { def, visualState: 'stale' as VisualState }
    }

    if (!foundNext && depsAreSatisfied(FOUNDATION_DEPS[def.id] ?? [], prereqs)) {
      foundNext = true
      return { def, visualState: 'next' as VisualState }
    }

    return { def, visualState: 'locked' as VisualState }
  })
}

export function deriveMaintenanceStates(
  prereqs: Record<string, PrereqRecord>,
  running: Record<string, boolean>,
): DerivedOp<MaintenanceOpDef>[] {
  return MAINTENANCE_OPS.map(def => {
    const prereq = prereqs[def.id]
    const isRunning = running[def.id] ?? false
    const deps: string[] = MAINTENANCE_DEPS[def.id] ?? []
    const visualState = deriveVisualState(prereq, prereqs, deps, isRunning)
    return { def, visualState }
  })
}

/**
 * True when every foundation op has `state === 'done'`. This is the gate for
 * the layout swap and Start Feature enablement.
 */
export function foundationDone(prereqs: Record<string, PrereqRecord>): boolean {
  return FOUNDATION_OPS.every(op => prereqs[op.id]?.state === 'done')
}

/**
 * True when every foundation op has state `done` OR `stale` — i.e. the
 * foundation has been laid down at least once, even if some ops are stale.
 * Used as the gate for layout swap and Start Feature enable; staleness alone
 * never disqualifies a Project from running features.
 */
export function foundationExists(prereqs: Record<string, PrereqRecord>): boolean {
  return FOUNDATION_OPS.every(op => {
    const s = prereqs[op.id]?.state
    return s === 'done' || s === 'stale'
  })
}

/** True when at least one foundation op is currently `stale`. */
export function anyFoundationStale(prereqs: Record<string, PrereqRecord>): boolean {
  return FOUNDATION_OPS.some(op => prereqs[op.id]?.state === 'stale')
}

/** Foundation op definitions whose state is currently `stale`, in DAG order. */
export function listStaleFoundationOps(
  prereqs: Record<string, PrereqRecord>,
): FoundationOpDef[] {
  return FOUNDATION_OPS.filter(op => prereqs[op.id]?.state === 'stale')
}
