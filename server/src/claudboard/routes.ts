import { Router, type Request, type Response } from 'express'
import { claudboardLaunchRequest } from '@bosch-sdlc/protocol'
import { getDb } from '../db.js'
import { isClaudboardInstalled } from './skill-discovery.js'
import { launchClaudboardRun } from './launcher.js'

const UNSUPPORTED_SKILLS = new Set(['workspace-init', 'workspace-link'])

const router = Router()

router.get('/claudboard/availability', (_req: Request, res: Response) => {
  res.json(isClaudboardInstalled())
})

router.post('/claudboard/run', async (req: Request, res: Response) => {
  const { repoId } = req.body as { repoId?: unknown }
  if (!repoId || typeof repoId !== 'string') {
    return void res.status(400).json({ error: 'repoId is required' })
  }

  if (UNSUPPORTED_SKILLS.has((req.body as { skill?: string }).skill ?? '')) {
    const skill = (req.body as { skill: string }).skill
    return void res.status(400).json({ error: `skill ${skill} must be run via CLI` })
  }

  const parsed = claudboardLaunchRequest.safeParse(req.body)
  if (!parsed.success) {
    return void res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
  }

  const availability = isClaudboardInstalled()
  if (!availability.installed) {
    return void res.status(412).json({
      error: 'claudboard plugin not installed',
      install: availability.installHint,
    })
  }

  const db = getDb()
  const repo = db.prepare('SELECT id, path FROM repos WHERE id = ?').get(repoId) as
    | { id: string; path: string }
    | undefined
  if (!repo) {
    return void res.status(404).json({ error: 'Repo not found' })
  }

  const { runId } = await launchClaudboardRun(repoId, repo.path, parsed.data)
  res.status(201).json({ runId })
})

export { router as claudboardRouter }
