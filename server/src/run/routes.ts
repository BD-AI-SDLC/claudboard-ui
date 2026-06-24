import { Router, type Request, type Response } from 'express'
import { createReadStream, existsSync } from 'node:fs'
import { getDb } from '../db.js'
import { createRunRecord } from './record.js'
import { buildPrompt } from './prompt-builder.js'
import { runFeature, setPausedUser, resumeRun, stopRun } from './driver.js'
import { checkFeatureWorkflowSkill } from './skill-check.js'
import { mapRunRow, loadPhaseCosts } from './serialize.js'
import { readEvents } from './event-log.js'
import { bootstrapGuard } from '../bootstrap/guard.js'
import type { CreateRunRequest } from '@bosch-sdlc/protocol'
import { AUTONOMY_VALUES, MODELS } from '@bosch-sdlc/protocol'

const router = Router()

router.get('/dashboard/summary', (_req, res) => {
  const db = getDb()
  const activeRuns = (db.prepare("SELECT COUNT(*) as n FROM runs WHERE status = 'running'").get() as { n: number }).n
  const awaitingGate = (db.prepare("SELECT COUNT(*) as n FROM runs WHERE status = 'paused-gate'").get() as { n: number }).n
  const inReview = (db.prepare("SELECT COUNT(*) as n FROM runs WHERE status = 'paused-user'").get() as { n: number }).n
  const mergedThisWeek = (db.prepare("SELECT COUNT(*) as n FROM runs WHERE status = 'done' AND completed_at > datetime('now', '-7 days')").get() as { n: number }).n
  res.json({ activeRuns, awaitingGate, inReview, mergedThisWeek })
})

router.post('/runs', bootstrapGuard, async (req: Request, res: Response) => {
  const body = req.body as CreateRunRequest
  if (!body.target || !body.prompt || !body.repoId) {
    return void res.status(400).json({ error: 'target, prompt, and repoId are required' })
  }
  if (!body.autonomy || !(AUTONOMY_VALUES as readonly string[]).includes(body.autonomy)) {
    return void res.status(400).json({
      error: `autonomy is required and must be one of: ${AUTONOMY_VALUES.join(', ')}`,
    })
  }

  const db = getDb()
  const repo = db.prepare('SELECT * FROM repos WHERE id = ?').get(body.repoId) as { id: string } | undefined
  if (!repo) return void res.status(404).json({ error: 'Repo not found' })

  const skillCheck = checkFeatureWorkflowSkill(body.target)
  if (!skillCheck.ok) {
    return void res.status(409).json({ error: skillCheck.reason })
  }

  const prompt = buildPrompt(body.prompt, body.autonomy)
  const record = createRunRecord({
    repoId: body.repoId,
    prompt: body.prompt,
    target: body.target,
    autonomy: body.autonomy,
    kind: 'feature',
  })

  res.status(201).json(record)

  console.info(`[run ${record.id}] model=${MODELS.feature} skill=feature`)
  runFeature(record.id, body.target, prompt, MODELS.feature).catch(
    (err: Error) => console.error(`Run ${record.id} failed:`, err.message),
  )
})

router.get('/runs', (req, res) => {
  const projectId = req.query['projectId'] as string | undefined
  if (!projectId) return void res.status(400).json({ error: 'projectId is required' })

  const db = getDb()
  const runs = db.prepare(`
    SELECT r.*,
           g.id          AS gate_id,
           g.kind        AS gate_kind,
           g.payload     AS gate_payload,
           g.snapshot    AS gate_snapshot,
           g.status      AS gate_status,
           g.resolution  AS gate_resolution,
           g.created_at  AS gate_created_at,
           g.resolved_at AS gate_resolved_at
    FROM runs r
    JOIN repos repo ON repo.id = r.project_id
    LEFT JOIN gates g ON g.run_id = r.id AND g.status = 'open'
    WHERE repo.project_id = ?
    ORDER BY r.created_at DESC
  `).all(projectId) as any[]

  const result = runs.map((row) => {
    const { gate_id, gate_kind, gate_payload, gate_snapshot, gate_status, gate_resolution, gate_created_at, gate_resolved_at, ...runRow } = row
    const openGate = gate_id ? {
      id: gate_id,
      runId: runRow.id,
      kind: gate_kind,
      payload: JSON.parse(gate_payload ?? '{}'),
      snapshot: gate_snapshot ? JSON.parse(gate_snapshot) : null,
      status: gate_status,
      resolution: gate_resolution ? JSON.parse(gate_resolution) : null,
      createdAt: gate_created_at,
      resolvedAt: gate_resolved_at,
    } : null
    return { ...mapRunRow(runRow), openGate }
  })
  res.json(result)
})

router.get('/runs/:id', (req, res) => {
  const db = getDb()
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params['id'])
  if (!run) return void res.status(404).json({ error: 'Not found' })
  const mapped = mapRunRow(run as Parameters<typeof mapRunRow>[0])
  const phaseCosts = loadPhaseCosts(db, mapped.id)
  res.json({ ...mapped, phaseCosts })
})

router.get('/runs/:id/events', (req, res) => {
  const db = getDb()
  const run = db.prepare('SELECT id FROM runs WHERE id = ?').get(req.params['id'])
  if (!run) return void res.status(404).json({ error: 'Not found' })
  const events = readEvents(req.params['id']!)
  res.json(events)
})

router.get('/runs/:id/transcript', (req, res) => {
  const db = getDb()
  const run = db.prepare('SELECT transcript_path FROM runs WHERE id = ?').get(req.params['id']) as { transcript_path: string } | undefined
  if (!run) return void res.status(404).json({ error: 'Not found' })
  if (!existsSync(run.transcript_path)) return void res.status(404).json({ error: 'Transcript not found' })
  res.setHeader('Content-Type', 'application/x-ndjson')
  createReadStream(run.transcript_path).pipe(res)
})

router.post('/runs/:id/pause', (req, res) => {
  const db = getDb()
  const run = db.prepare('SELECT status FROM runs WHERE id = ?').get(req.params['id']) as { status: string } | undefined
  if (!run) return void res.status(404).json({ error: 'Not found' })
  if (run.status !== 'running') {
    return void res.status(409).json({ error: `Cannot pause a run with status '${run.status}'` })
  }
  db.prepare("UPDATE runs SET status='paused-user' WHERE id=?").run(req.params['id'])
  const ok = setPausedUser(req.params['id']!)
  if (!ok) return void res.status(409).json({ error: 'Already paused' })
  res.json({ paused: true })
})

router.post('/runs/:id/resume', (req, res) => {
  const db = getDb()
  const run = db.prepare('SELECT status FROM runs WHERE id = ?').get(req.params['id']) as { status: string } | undefined
  if (!run) return void res.status(404).json({ error: 'Not found' })
  if (run.status !== 'paused-user') {
    return void res.status(409).json({ error: `Cannot resume a run with status '${run.status}'` })
  }
  db.prepare("UPDATE runs SET status='running' WHERE id=?").run(req.params['id'])
  resumeRun(req.params['id']!)
  res.json({ resumed: true })
})

router.post('/runs/:id/stop', (req, res) => {
  const result = stopRun(req.params['id']!)
  if (!result.ok) {
    const code = result.reason === 'not-found' ? 404 : 409
    return void res.status(code).json({ error: result.reason })
  }
  return void res.status(200).json({ cancelled: true })
})

export { router as runRouter }
