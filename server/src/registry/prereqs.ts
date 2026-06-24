import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import type { PrereqState, StaleReason } from '@bosch-sdlc/protocol'

const STALE_DAYS = 7
const MS_PER_DAY = 86_400_000

export interface PrereqDetection {
  cmd: 'analyse' | 'generate' | 'workflow' | 'refresh' | 'techdebt'
  state: PrereqState
  output: string | null
  staleReason: StaleReason | null
}

function mtimeMs(filePath: string): number | null {
  try {
    return statSync(filePath).mtime.getTime()
  } catch {
    return null
  }
}

function isAgedOut(mtime: number): boolean {
  return Date.now() - mtime > STALE_DAYS * MS_PER_DAY
}

function hasGitActivitySince(mtime: number, repoPath: string): boolean {
  try {
    const since = new Date(mtime).toISOString()
    const result = execSync(`git log --since="${since}" --oneline`, {
      cwd: repoPath,
      stdio: 'pipe',
    }).toString().trim()
    return result.length > 0
  } catch {
    return false
  }
}

/**
 * Foundation ops (analyse, generate, workflow) are evaluated independently
 * as binary existence checks: `done` if the artifact is on disk, `missing` otherwise.
 * Maintenance ops (refresh, techdebt) retain their independent per-op behavior.
 */
export function detectPrereqs(repoPath: string): PrereqDetection[] {
  const results: PrereqDetection[] = []

  // ── foundation ────────────────────────────────────────────────────────────
  // analyse: binary — artifact exists → done, absent → missing.
  const analysisPath = join(repoPath, '.claude', 'reports', 'claudboard-analysis.md')
  const analyseState: PrereqState = existsSync(analysisPath) ? 'done' : 'missing'
  results.push({
    cmd: 'analyse',
    state: analyseState,
    output: analyseState === 'missing' ? null : '.claude/reports/claudboard-analysis.md',
    staleReason: null,
  })

  // generate: binary — CLAUDE.md + .claude/rules/ both exist → done, otherwise → missing.
  const claudeMdPath = join(repoPath, 'CLAUDE.md')
  const rulesDir = join(repoPath, '.claude', 'rules')
  const generateState: PrereqState = existsSync(claudeMdPath) && existsSync(rulesDir) ? 'done' : 'missing'
  results.push({
    cmd: 'generate',
    state: generateState,
    output: generateState === 'missing' ? null : 'CLAUDE.md',
    staleReason: null,
  })

  // workflow: binary — SKILL.md exists → done, absent → missing.
  const skillPath = join(repoPath, '.claude', 'skills', 'feature-workflow', 'SKILL.md')
  const workflowState: PrereqState = existsSync(skillPath) ? 'done' : 'missing'
  results.push({
    cmd: 'workflow',
    state: workflowState,
    output: workflowState === 'missing' ? null : '.claude/skills/feature-workflow/SKILL.md',
    staleReason: null,
  })

  // ── maintenance ───────────────────────────────────────────────────────────
  // refresh: always stale, no reason — it's an action prompt, not a derivation.
  results.push({ cmd: 'refresh', state: 'stale', output: null, staleReason: null })

  // techdebt: independent git-activity heuristic against its own artifact.
  const techdebtPath = join(repoPath, '.claude', 'reports', 'tech-debt', 'summary.md')
  const techdebtMtime = mtimeMs(techdebtPath)
  let techdebtState: PrereqState
  let techdebtReason: StaleReason | null = null
  if (techdebtMtime === null) {
    techdebtState = 'missing'
  } else if (hasGitActivitySince(techdebtMtime, repoPath)) {
    techdebtState = 'stale'
    techdebtReason = 'codebase-changed'
  } else if (isAgedOut(techdebtMtime)) {
    techdebtState = 'stale'
    techdebtReason = 'aged-out'
  } else {
    techdebtState = 'done'
  }
  results.push({
    cmd: 'techdebt',
    state: techdebtState,
    output: techdebtState === 'missing' ? null : '.claude/reports/tech-debt/summary.md',
    staleReason: techdebtReason,
  })

  return results
}
