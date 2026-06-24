import type { Autonomy, PhaseCost, Run } from '@bosch-sdlc/protocol'
import { AUTONOMY_VALUES, DEFAULT_AUTONOMY } from '@bosch-sdlc/protocol'
import type Database from 'better-sqlite3'

interface RunRow {
  id: string
  project_id: string
  kind: string
  status: string
  prompt: string
  target: string
  transcript_path: string
  created_at: string
  completed_at: string | null
  cost_cents: number | null
  cost_usd: number | null
  input_tokens: number | null
  output_tokens: number | null
  autonomy: string | null
  error_message: string | null
}

interface PhaseCostRow {
  phase_num: number
  phase_title: string
  cost_usd: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  api_calls: number
  model: string
}

function normaliseAutonomy(value: string | null): Autonomy {
  if (value && (AUTONOMY_VALUES as readonly string[]).includes(value)) {
    return value as Autonomy
  }
  return DEFAULT_AUTONOMY
}

export function mapRunRow(row: RunRow): Omit<Run, 'openGate' | 'phaseCosts'> {
  return {
    id: row.id,
    repoId: row.project_id,
    kind: row.kind as Run['kind'],
    status: row.status as Run['status'],
    prompt: row.prompt,
    target: row.target,
    transcriptPath: row.transcript_path,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    cost: row.cost_cents != null ? row.cost_cents / 100 : null,
    costUsd: row.cost_usd ?? null,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    autonomy: normaliseAutonomy(row.autonomy),
    errorMessage: row.error_message,
  }
}

export function loadPhaseCosts(db: Database.Database, runId: string): PhaseCost[] {
  const rows = db
    .prepare('SELECT * FROM phase_costs WHERE run_id = ? ORDER BY phase_num ASC')
    .all(runId) as PhaseCostRow[]
  return rows.map((r) => ({
    phaseNum: r.phase_num,
    phaseTitle: r.phase_title,
    costUsd: r.cost_usd,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    apiCalls: r.api_calls,
    model: r.model,
  }))
}
