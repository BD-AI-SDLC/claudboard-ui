import { Router } from 'express'
import { basename } from 'node:path'
import { getDb } from '../db.js'
import { scanDirectory } from './scanner.js'
import { classify } from './classifier.js'
import { detectPrereqs } from './prereqs.js'
import { upsertProject, upsertRepo, upsertPrereqs, detachMissingRepos } from './persist.js'
import { browseFsHandler } from './fs-browser.js'
import { buildPrereqMap, mapRepoRow } from './project-config.js'

interface ProjectRow {
  id: string
  root: string
  name: string | null
  topology: string | null
  mark: string | null
  status: string
  created_at: string
  last_active_at: string | null
}

function mapProjectRow(row: ProjectRow) {
  const name = row.name ?? basename(row.root)
  return {
    id: row.id,
    path: row.root,
    name,
    topology: row.topology ?? 'monolith',
    mark: row.mark ?? (name[0] ?? 'X').toUpperCase(),
    status: row.status,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  }
}

function deriveMark(name: string): string {
  const parts = name.split(/[-_ .]+/).filter(Boolean)
  if (parts.length <= 1) return (parts[0]?.[0] ?? name[0] ?? 'X').toUpperCase()
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}

const router = Router()

router.get('/projects', (_req, res) => {
  const db = getDb()
  const rows = db.prepare("SELECT * FROM projects WHERE status = 'active'").all() as ProjectRow[]
  res.json(rows.map(mapProjectRow))
})

router.get('/projects/active', (_req, res) => {
  const db = getDb()
  const setting = db.prepare("SELECT value FROM kv_settings WHERE key = 'active_project_id'").get() as { value: string | null } | undefined
  const activeId = setting?.value ?? null
  if (!activeId) return void res.json({ activeProjectId: null, activeProject: null })
  const row = db.prepare("SELECT * FROM projects WHERE id = ? AND status = 'active'").get(activeId) as ProjectRow | undefined
  if (!row) {
    db.prepare("UPDATE kv_settings SET value = NULL WHERE key = 'active_project_id'").run()
    return void res.json({ activeProjectId: null, activeProject: null })
  }
  res.json({ activeProjectId: activeId, activeProject: mapProjectRow(row) })
})

router.put('/projects/active', (req, res) => {
  const { projectId } = req.body as { projectId: string }
  if (!projectId) return void res.status(400).json({ error: 'projectId is required' })
  const db = getDb()
  const row = db.prepare("SELECT * FROM projects WHERE id = ? AND status = 'active'").get(projectId) as ProjectRow | undefined
  if (!row) return void res.status(404).json({ error: 'Project not found or detached' })
  const now = new Date().toISOString()
  db.prepare("UPDATE projects SET last_active_at = ? WHERE id = ?").run(now, projectId)
  db.prepare("UPDATE kv_settings SET value = ? WHERE key = 'active_project_id'").run(projectId)
  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow
  res.json({ activeProjectId: projectId, activeProject: mapProjectRow(updated) })
})

router.post('/projects', async (req, res) => {
  const body = req.body as { root?: string; mark?: string }

  if (!body.root) return void res.status(400).json({ error: 'root is required' })
  const root = body.root

  const scan = scanDirectory(root)
  const childScans = new Map()
  for (const childPath of scan.childRepos) {
    childScans.set(childPath, scanDirectory(childPath))
  }

  const classified = classify(root, scan, childScans)
  const detectedTopology: string = classified.repos[0]?.topology ?? 'monolith'

  const name = basename(root)
  const mark = body.mark ?? deriveMark(name)
  const projectId = upsertProject(root, { name, topology: detectedTopology, mark })
  const activePaths = new Set<string>()

  for (const repo of classified.repos) {
    const repoId = upsertRepo(projectId, repo)
    const prereqs = detectPrereqs(repo.path)
    upsertPrereqs(repoId, prereqs)
    activePaths.add(repo.path)
  }

  detachMissingRepos(projectId, activePaths)

  const db = getDb()
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow
  const response = {
    ...mapProjectRow(project),
    detectedTopology,
  }
  res.status(201).json(response)
})

router.delete('/projects/:id', (req, res) => {
  const db = getDb()
  db.prepare("UPDATE projects SET status = 'detached' WHERE id = ?").run(req.params['id'])
  db.prepare("UPDATE repos SET status = 'detached' WHERE project_id = ?").run(req.params['id'])
  db.prepare("UPDATE kv_settings SET value = NULL WHERE key = 'active_project_id' AND value = ?").run(req.params['id'])
  res.status(204).send()
})

router.get('/repos', (req, res) => {
  const projectId = req.query['projectId'] as string | undefined
  if (!projectId) return void res.status(400).json({ error: 'projectId is required' })
  const db = getDb()
  const repos = db.prepare("SELECT * FROM repos WHERE project_id = ? AND status = 'active'").all(projectId) as Parameters<typeof mapRepoRow>[0][]
  res.json(repos.map((row) => mapRepoRow(row, db)))
})

router.get('/repos/:id', (req, res) => {
  const db = getDb()
  const repo = db.prepare('SELECT * FROM repos WHERE id = ?').get(req.params['id']) as Parameters<typeof mapRepoRow>[0] | undefined
  if (!repo) return void res.status(404).json({ error: 'Not found' })
  res.json(mapRepoRow(repo, db))
})

router.get('/repos/:id/prereqs', (req, res) => {
  const db = getDb()
  const repoId = req.params['id'] as string

  const repo = db.prepare('SELECT id, path FROM repos WHERE id = ?').get(repoId) as { id: string; path: string } | undefined
  if (!repo) return void res.status(404).json({ error: 'Repo not found' })

  res.json(buildPrereqMap(repoId, repo.path, db))
})

router.get('/fs/browse', (req, res) => {
  browseFsHandler(req, res).catch((err: Error) => {
    if (!res.headersSent) res.status(500).json({ error: err.message })
  })
})

export { router as projectRegistryRouter }
