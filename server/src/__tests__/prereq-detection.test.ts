/**
 * Binary-existence tests for detectPrereqs. Foundation ops (analyse, generate,
 * workflow) report `done` when their artifact is on disk and `missing`
 * otherwise — no staleness, no cascade. Maintenance ops (refresh, techdebt) retain
 * their independent heuristics.
 */

import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { detectPrereqs } from '../registry/prereqs.js'

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'prereq-detect-'))
  execSync('git init -q', { cwd: dir })
  execSync('git config user.email t@t', { cwd: dir })
  execSync('git config user.name t', { cwd: dir })
  return dir
}

function setMtime(path: string, isoOrDate: string | Date) {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  utimesSync(path, d, d)
}

function seedAnalyse(repo: string, mtime: Date) {
  const p = join(repo, '.claude', 'reports')
  mkdirSync(p, { recursive: true })
  const f = join(p, 'claudboard-analysis.md')
  writeFileSync(f, 'analysis\n')
  setMtime(f, mtime)
  return f
}

function seedGenerate(repo: string, mtime: Date) {
  mkdirSync(join(repo, '.claude', 'rules'), { recursive: true })
  writeFileSync(join(repo, '.claude', 'rules', 'r.md'), 'rule\n')
  const f = join(repo, 'CLAUDE.md')
  writeFileSync(f, 'claude\n')
  setMtime(f, mtime)
  return f
}

function seedWorkflow(repo: string, mtime: Date) {
  const p = join(repo, '.claude', 'skills', 'feature-workflow')
  mkdirSync(p, { recursive: true })
  const f = join(p, 'SKILL.md')
  writeFileSync(f, 'skill\n')
  setMtime(f, mtime)
  return f
}

function commitSomething(repo: string, msg = 'change') {
  writeFileSync(join(repo, `f-${Date.now()}.txt`), 'x')
  execSync(`git add . && git commit -q -m "${msg}"`, { cwd: repo })
}

describe('detectPrereqs — foundation ops (binary existence)', () => {
  let repo: string

  beforeEach(() => {
    repo = makeRepo()
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  function byCmd(repoPath: string) {
    const map: Record<string, ReturnType<typeof detectPrereqs>[number]> = {}
    for (const d of detectPrereqs(repoPath)) map[d.cmd] = d
    return map
  }

  it('all artifacts present, no commits → all done, null staleReason', () => {
    const t = new Date(Date.now() - 60_000)
    seedAnalyse(repo, t)
    seedGenerate(repo, t)
    seedWorkflow(repo, t)
    const r = byCmd(repo)
    expect(r['analyse']).toMatchObject({ state: 'done', staleReason: null })
    expect(r['generate']).toMatchObject({ state: 'done', staleReason: null })
    expect(r['workflow']).toMatchObject({ state: 'done', staleReason: null })
  })

  it('aged artifacts (10d) with git commits since → still done, not stale', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000)
    seedAnalyse(repo, tenDaysAgo)
    seedGenerate(repo, tenDaysAgo)
    seedWorkflow(repo, tenDaysAgo)
    commitSomething(repo)
    const r = byCmd(repo)
    expect(r['analyse']).toMatchObject({ state: 'done', staleReason: null })
    expect(r['generate']).toMatchObject({ state: 'done', staleReason: null })
    expect(r['workflow']).toMatchObject({ state: 'done', staleReason: null })
  })

  it('re-running analyse (bumping its mtime) does not flip generate/workflow to stale', () => {
    const earlier = new Date(Date.now() - 5 * 60_000)
    const later = new Date(Date.now() - 30_000)
    seedGenerate(repo, earlier)
    seedWorkflow(repo, earlier)
    seedAnalyse(repo, later)
    const r = byCmd(repo)
    expect(r['analyse']).toMatchObject({ state: 'done', staleReason: null })
    expect(r['generate']).toMatchObject({ state: 'done', staleReason: null })
    expect(r['workflow']).toMatchObject({ state: 'done', staleReason: null })
  })

  it('missing generate artifact does not cascade — workflow remains done if its own artifact exists', () => {
    const t = new Date(Date.now() - 60_000)
    seedAnalyse(repo, t)
    // No generate. Workflow file is present.
    seedWorkflow(repo, t)
    const r = byCmd(repo)
    expect(r['analyse']).toMatchObject({ state: 'done', staleReason: null })
    expect(r['generate']).toMatchObject({ state: 'missing', staleReason: null })
    expect(r['workflow']).toMatchObject({ state: 'done', staleReason: null })
  })

  it('manually deleting an artifact flips the op to missing on next detection', () => {
    const t = new Date(Date.now() - 60_000)
    const analysisFile = seedAnalyse(repo, t)
    seedGenerate(repo, t)
    seedWorkflow(repo, t)

    // All done before deletion
    expect(byCmd(repo)['analyse']!.state).toBe('done')

    // Delete and re-detect
    unlinkSync(analysisFile)
    expect(byCmd(repo)['analyse']!.state).toBe('missing')
  })

  it('no artifacts → all missing', () => {
    const r = byCmd(repo)
    expect(r['analyse']).toMatchObject({ state: 'missing', staleReason: null })
    expect(r['generate']).toMatchObject({ state: 'missing', staleReason: null })
    expect(r['workflow']).toMatchObject({ state: 'missing', staleReason: null })
  })
})

describe('detectPrereqs — maintenance ops', () => {
  let repo: string

  beforeEach(() => {
    repo = makeRepo()
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('refresh is always stale with null staleReason', () => {
    const r = detectPrereqs(repo).find((d) => d.cmd === 'refresh')!
    expect(r.state).toBe('stale')
    expect(r.staleReason).toBeNull()
  })

  it('techdebt uses git-activity independently of foundation state', () => {
    const past = new Date(Date.now() - 60_000)
    const path = join(repo, '.claude', 'reports', 'tech-debt')
    mkdirSync(path, { recursive: true })
    const f = join(path, 'summary.md')
    writeFileSync(f, 'td\n')
    utimesSync(f, past, past)
    commitSomething(repo)
    const r = detectPrereqs(repo).find((d) => d.cmd === 'techdebt')!
    expect(r.state).toBe('stale')
    expect(r.staleReason).toBe('codebase-changed')
  })

  it('techdebt aged-out when older than 7d with no commits since', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000)
    const path = join(repo, '.claude', 'reports', 'tech-debt')
    mkdirSync(path, { recursive: true })
    const f = join(path, 'summary.md')
    writeFileSync(f, 'td\n')
    utimesSync(f, tenDaysAgo, tenDaysAgo)
    const r = detectPrereqs(repo).find((d) => d.cmd === 'techdebt')!
    expect(r.state).toBe('stale')
    expect(r.staleReason).toBe('aged-out')
  })

  it('techdebt missing when artifact is absent', () => {
    const r = detectPrereqs(repo).find((d) => d.cmd === 'techdebt')!
    expect(r.state).toBe('missing')
    expect(r.staleReason).toBeNull()
  })
})
