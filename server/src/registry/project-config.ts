import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Autonomy, PrereqRecord, Repo } from '@bosch-sdlc/protocol'
import { AUTONOMY_VALUES, DEFAULT_AUTONOMY } from '@bosch-sdlc/protocol'
import { detectPrereqs } from './prereqs.js'

export interface RepoRow {
  id: string
  project_id: string
  path: string
  name: string
  topology: string
  status: string
}

/**
 * Read `clarify.defaultAutonomy` from the repo's
 * `.claude/skills/feature-workflow/config.json`. Returns `DEFAULT_AUTONOMY`
 * when the file is missing, unreadable, or contains an invalid value.
 */
export function readDefaultAutonomy(repoPath: string): Autonomy {
  const configPath = join(repoPath, '.claude', 'skills', 'feature-workflow', 'config.json')
  if (!existsSync(configPath)) return DEFAULT_AUTONOMY

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch (err) {
    console.warn(`[project-config] Failed to parse ${configPath}: ${(err as Error).message}`)
    return DEFAULT_AUTONOMY
  }

  const value = (parsed as { clarify?: { defaultAutonomy?: unknown } } | null)?.clarify?.defaultAutonomy
  if (typeof value !== 'string') return DEFAULT_AUTONOMY
  if ((AUTONOMY_VALUES as readonly string[]).includes(value)) {
    return value as Autonomy
  }
  console.warn(
    `[project-config] ${configPath} has invalid clarify.defaultAutonomy="${value}" — using "${DEFAULT_AUTONOMY}"`,
  )
  return DEFAULT_AUTONOMY
}

/**
 * Resolve the active tracker's project key from the repo's feature-workflow config.
 * Returns null when the file is missing/unparseable, the tracker is missing/unknown,
 * the key block is absent, or the key value is the `__stub__` sentinel, a
 * `[TODO:` template literal, or empty. Does NOT fall back across trackers.
 */
export function readFeatureWorkflowProjectKey(repoPath: string): string | null {
  const configPath = join(repoPath, '.claude', 'skills', 'feature-workflow', 'config.json')
  if (!existsSync(configPath)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch (err) {
    console.warn(`[project-config] Failed to parse ${configPath}: ${(err as Error).message}`)
    return null
  }

  const root = parsed as { tracker?: unknown; jira?: { projectKey?: unknown }; tr?: { projectKey?: unknown } } | null
  const tracker = root?.tracker
  let raw: unknown
  if (tracker === 'jira') raw = root?.jira?.projectKey
  else if (tracker === 'tr') raw = root?.tr?.projectKey
  else return null

  if (typeof raw !== 'string') return null
  if (raw === '' || raw === '__stub__' || raw.startsWith('[TODO:')) return null
  return raw
}

interface PrereqCacheRow {
  id: string
  cmd: string
  last_run: string | null
  duration_ms: number | null
  cost_cents: number | null
}

/**
 * Build the per-repo prereq map by combining filesystem detection
 * (`detectPrereqs`) with the cached run metadata from the `prereqs` table.
 * Single source of truth for what `Repo.prereqs` looks like — invoked by
 * `mapRepoRow` (for /api/repos and /api/repos/:id) and by the dedicated
 * /api/repos/:id/prereqs handler.
 */
export function buildPrereqMap(
  repoId: string,
  repoPath: string,
  db: Database.Database,
): Record<string, PrereqRecord> {
  const detections = detectPrereqs(repoPath)
  const cacheRows = db
    .prepare('SELECT id, cmd, last_run, duration_ms, cost_cents FROM prereqs WHERE project_id = ?')
    .all(repoId) as PrereqCacheRow[]
  const cacheByCmd = new Map<
    string,
    { id: string; lastRun: string | null; duration: number | null; cost: number | null }
  >()
  for (const row of cacheRows) {
    cacheByCmd.set(row.cmd, {
      id: row.id,
      lastRun: row.last_run,
      duration: row.duration_ms,
      cost: row.cost_cents,
    })
  }
  const map: Record<string, PrereqRecord> = {}
  for (const d of detections) {
    const cached = cacheByCmd.get(d.cmd)
    map[d.cmd] = {
      id: cached?.id ?? randomUUID(),
      repoId,
      cmd: d.cmd,
      state: d.state,
      lastRun: cached?.lastRun ?? null,
      duration: cached?.duration ?? null,
      cost: cached?.cost ?? null,
      output: d.output,
      staleReason: d.staleReason,
    }
  }
  return map
}

export function mapRepoRow(row: RepoRow, db: Database.Database): Repo {
  return {
    id: row.id,
    projectId: row.project_id,
    path: row.path,
    name: row.name,
    topology: row.topology as Repo['topology'],
    status: row.status as Repo['status'],
    prereqs: buildPrereqMap(row.id, row.path, db),
    defaultAutonomy: readDefaultAutonomy(row.path),
    featureWorkflowProjectKey: readFeatureWorkflowProjectKey(row.path),
  }
}
