import type { ClaudboardLaunchRequest } from '@bosch-sdlc/protocol'
import { MODELS } from '@bosch-sdlc/protocol'
import { createRunRecord } from '../run/record.js'
import { runFeature } from '../run/driver.js'
import { getDb } from '../db.js'
import { markPrereqRan } from '../registry/persist.js'
import { buildAnalysePrompt } from './prompt-templates/analyse.js'
import { buildGeneratePrompt } from './prompt-templates/generate.js'
import { buildWorkflowPrompt } from './prompt-templates/workflow.js'

const cmdBySkill = { analyse: 'analyse', generate: 'generate', workflow: 'workflow' } as const

function buildPrompt(request: ClaudboardLaunchRequest): string {
  switch (request.skill) {
    case 'analyse': return buildAnalysePrompt(request)
    case 'generate': return buildGeneratePrompt(request)
    case 'workflow': return buildWorkflowPrompt(request)
  }
}

export async function launchClaudboardRun(
  repoId: string,
  target: string,
  request: ClaudboardLaunchRequest,
): Promise<{ runId: string }> {
  const prompt = buildPrompt(request)
  const kind = `claudboard-${request.skill}` as const

  const record = createRunRecord({
    repoId,
    prompt,
    target,
    autonomy: 'autopilot',
    kind,
  })

  const skill = request.skill
  console.info(`[run ${record.id}] model=${MODELS[skill]} skill=${skill}`)
  runFeature(record.id, target, prompt, MODELS[skill])
    .then(() => {
      const db = getDb()
      const post = db
        .prepare('SELECT status, created_at, completed_at FROM runs WHERE id = ?')
        .get(record.id) as { status: string; created_at: string; completed_at: string | null } | undefined
      if (post?.status !== 'done' || !post.completed_at) return
      const startedMs = Date.parse(post.created_at + 'Z')
      const completedMs = Date.parse(post.completed_at + 'Z')
      const durationMs = Number.isFinite(startedMs) && Number.isFinite(completedMs) ? completedMs - startedMs : null
      markPrereqRan(repoId, cmdBySkill[request.skill], new Date(completedMs).toISOString(), durationMs)
    })
    .catch((err: Error) => console.error(`Claudboard run ${record.id} failed:`, err.message))

  return { runId: record.id }
}
