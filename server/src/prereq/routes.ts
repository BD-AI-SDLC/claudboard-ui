import { Router } from 'express'
import { getDb } from '../db.js'
import { validatePrereqDependencies } from './validators.js'
import { createRunRecord } from '../run/record.js'
import { runPrereqViaCli, downgradeToFailed, submitCliAnswer } from './cli-runner.js'
import { detectPrereqs, type PrereqDetection } from '../registry/prereqs.js'
import { markPrereqRan } from '../registry/persist.js'
import { bootstrapGuard } from '../bootstrap/guard.js'

const VALID_CMDS = new Set(['analyse', 'generate', 'workflow', 'refresh', 'techdebt'])

// Expected primary artifact per cmd (relative to repo root). When CLI exits 0
// but the artifact is missing, the run is downgraded to failed.
const EXPECTED_ARTIFACT: Record<string, string | null> = {
  analyse: '.claude/reports/claudboard-analysis.md',
  generate: 'CLAUDE.md',
  'workflow': '.claude/skills/feature-workflow/SKILL.md',
  techdebt: '.claude/reports/tech-debt/summary.md',
  refresh: null, // no durable artifact — code-0 alone is sufficient
}

const router = Router()

router.post('/prereqs/:cmd', bootstrapGuard, async (req, res) => {
  const { cmd } = req.params as { cmd: string }
  const { target } = req.body as { target: string }

  if (!VALID_CMDS.has(cmd)) {
    return void res.status(400).json({ error: `Unknown command: ${cmd}. Valid: ${[...VALID_CMDS].join(', ')}` })
  }
  if (!target) {
    return void res.status(400).json({ error: 'target is required' })
  }

  const db = getDb()

  // Find the repo by target path
  const repo = db.prepare('SELECT id FROM repos WHERE path = ?').get(target) as { id: string } | undefined
  if (!repo) {
    return void res.status(404).json({ error: 'Repo not found for target path. Register it via POST /api/projects first.' })
  }

  // Validate predecessor prereqs
  const { ok, missing } = validatePrereqDependencies(repo.id, cmd, target)
  if (!ok) {
    const missingList = missing.join(', ')
    return void res.status(409).json({
      error: `Cannot run /${cmd}: requires [${missingList}] to be done first. Run those prereqs first.`,
    })
  }

  // The CLI subprocess does its own slash-command preprocessing — we pass the
  // slash verbatim as argv, never as a prompt string. Persist the slash in the
  // prompt column for forensic clarity.
  const promptForRecord = `/${cmd}`
  const record = createRunRecord({
    repoId: repo.id,
    prompt: promptForRecord,
    target,
    kind: 'prereq',
    // Prereq runs do not consult autonomy; persist the default so the column
    // constraint holds and `Run.autonomy` is always well-typed.
    autonomy: 'balanced',
  })

  res.status(201).json(record)

  // Run async; on subprocess exit, re-detect prereqs from the filesystem and
  // downgrade to failed if the expected artifact is missing after a code-0
  // exit. runPrereqViaCli resolves on exit regardless of success/failure.
  void runPrereqViaCli(record.id, target, cmd).then(() => {
    const detections = detectPrereqs(target)

    const post = db
      .prepare('SELECT status, created_at, completed_at FROM runs WHERE id=?')
      .get(record.id) as { status: string; created_at: string; completed_at: string | null } | undefined
    if (post?.status === 'done') {
      const expected = EXPECTED_ARTIFACT[cmd]
      let downgraded = false
      if (expected !== null && expected !== undefined) {
        const detection = detections.find((d: PrereqDetection) => d.cmd === cmd)
        if (!detection || detection.state === 'missing') {
          downgradeToFailed(
            record.id,
            `Command exited 0 but expected artifact ${expected} was not written`,
          )
          downgraded = true
        }
      }
      if (!downgraded && post.completed_at) {
        const startedMs = Date.parse(post.created_at + 'Z')
        const completedMs = Date.parse(post.completed_at + 'Z')
        const durationMs = Number.isFinite(startedMs) && Number.isFinite(completedMs)
          ? completedMs - startedMs
          : null
        markPrereqRan(repo.id, cmd, new Date(completedMs).toISOString(), durationMs)
      }
    }
  })
})

/**
 * Deliver the user's answer to a pending AskUserQuestion in a live prereq
 * run. NOT bootstrap-guarded — the run already exists and was started after
 * bootstrap was ready; gating now would orphan the subprocess.
 */
router.post('/runs/:id/cli-answer', (req, res) => {
  const runId = req.params['id']
  const body = req.body as { toolUseId?: unknown; answers?: unknown }

  if (typeof body?.toolUseId !== 'string' || !Array.isArray(body.answers)) {
    return void res.status(400).json({
      error: 'Body must be { toolUseId: string; answers: Array<{ answer: string }> }',
    })
  }
  const answers: Array<{ answer: string }> = []
  for (const a of body.answers) {
    if (typeof a !== 'object' || a === null || typeof (a as { answer?: unknown }).answer !== 'string') {
      return void res.status(400).json({ error: 'Each answer must be { answer: string }' })
    }
    answers.push({ answer: (a as { answer: string }).answer })
  }

  const result = submitCliAnswer(runId!, body.toolUseId, answers)
  if (result.ok) return void res.status(200).json({ ok: true })

  switch (result.reason) {
    case 'unknown-run':
      return void res.status(404).json({ error: 'Run not found' })
    case 'unknown-tool-use':
      return void res.status(404).json({ error: 'Tool use id not pending for this run' })
    case 'run-exited':
      return void res.status(409).json({ error: 'Run has exited' })
  }
})

export { router as prereqRouter }
