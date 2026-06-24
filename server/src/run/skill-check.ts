import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface SkillCheckResult {
  ok: boolean
  reason?: string
}

export function checkFeatureWorkflowSkill(repoPath: string): SkillCheckResult {
  const skillPath = join(repoPath, '.claude', 'skills', 'feature-workflow', 'SKILL.md')

  if (!existsSync(skillPath)) {
    return {
      ok: false,
      reason: "This repo has no feature-workflow skill. Run /claudboard-workflow to generate one.",
    }
  }

  const content = readFileSync(skillPath, 'utf-8')
  if (!content.includes('mcp__bosch__')) {
    return {
      ok: false,
      reason: "This repo's feature-workflow was generated with an older template. Re-run /claudboard-workflow to update.",
    }
  }

  return { ok: true }
}
