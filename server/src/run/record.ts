import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDb } from '../db.js'
import type { Autonomy, CreateRunRequest, RunKind } from '@bosch-sdlc/protocol'

const TRANSCRIPTS_DIR = join(homedir(), '.bosch-sdlc', 'transcripts')

export interface RunRecord {
  id: string
  repoId: string
  kind: RunKind
  status: string
  prompt: string
  target: string
  transcriptPath: string
  autonomy: Autonomy
}

export function createRunRecord(req: CreateRunRequest & { kind?: RunKind }): RunRecord {
  const db = getDb()
  const id = randomUUID()
  const kind = req.kind ?? 'feature'
  const transcriptPath = join(TRANSCRIPTS_DIR, `${id}.jsonl`)

  if (!req.target) throw new Error('target is required')
  if (!req.repoId) throw new Error('repoId is required')
  if (!req.autonomy) throw new Error('autonomy is required')

  db.prepare(`
    INSERT INTO runs (id, project_id, kind, status, prompt, target, transcript_path, autonomy)
    VALUES (?, ?, ?, 'running', ?, ?, ?, ?)
  `).run(id, req.repoId, kind, req.prompt, req.target, transcriptPath, req.autonomy)

  return {
    id, repoId: req.repoId, kind, status: 'running',
    prompt: req.prompt, target: req.target,
    transcriptPath,
    autonomy: req.autonomy,
  }
}
