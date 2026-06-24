/**
 * Tests cost engine slug derivation and computeCost fast-path/fallback.
 *
 * The slug rule must mirror Claude Code's own: every run of one-or-more
 * non-[A-Za-z0-9-] characters collapses to a single '-'. The earlier
 * `replaceAll('/', '-')` rule broke for any cwd containing a '.', which
 * is what surfaced the post-smoke bug.
 */

import { homedir, tmpdir } from 'node:os'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { sessionJsonlPath, computeCost } from '../engine.js'

describe('sessionJsonlPath — slug derivation', () => {
  it('normalises a standard absolute cwd', () => {
    const p = sessionJsonlPath('/Users/alice/code/myrepo', 'abc-123')
    expect(p).toBe(join(homedir(), '.claude', 'projects', '-Users-alice-code-myrepo', 'abc-123.jsonl'))
  })

  it('normalises a dotted cwd (the regression case)', () => {
    const p = sessionJsonlPath('/Users/alice/code/myproj.cloud', 'sid')
    expect(p).toBe(join(homedir(), '.claude', 'projects', '-Users-alice-code-myproj-cloud', 'sid.jsonl'))
  })

  it('collapses runs of special chars to a single dash', () => {
    const p = sessionJsonlPath('/a/b...c d/e', 'sid')
    // '/', '...', ' ' all collapse to a single '-'
    expect(p).toBe(join(homedir(), '.claude', 'projects', '-a-b-c-d-e', 'sid.jsonl'))
  })
})

describe('computeCost — script + glob fallback', () => {
  let tmpHome: string
  let tmpScript: string
  let projectsDir: string

  beforeEach(() => {
    // Stand up a fake ~/.claude/projects/ tree we can control
    tmpHome = mkdtempSync(join(tmpdir(), 'cost-engine-test-'))
    projectsDir = join(tmpHome, '.claude', 'projects')
    mkdirSync(projectsDir, { recursive: true })

    // Stub a compute-cost script that just echoes a fixed JSON payload
    tmpScript = join(tmpHome, 'compute-cost.sh')
    writeFileSync(tmpScript, '#!/bin/sh\ncat <<EOF\n{"total_usd":1.23,"model":"m","api_calls":2,"tokens":{"input_uncached":10,"output":20,"cache_read":5}}\nEOF\n')
    chmodSync(tmpScript, 0o755)
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
  })

  it('returns null when scriptPath is null', async () => {
    const result = await computeCost({
      scriptPath: null,
      sessionJsonl: '/anywhere.jsonl',
      since: '2026-01-01T00:00:00Z',
    })
    expect(result).toBeNull()
  })

  it('returns null when sessionJsonl is missing AND no glob fallback matches', async () => {
    const result = await computeCost({
      scriptPath: tmpScript,
      sessionJsonl: join(projectsDir, '-not-real', 'no-such-session.jsonl'),
      since: '2026-01-01T00:00:00Z',
    })
    expect(result).toBeNull()
  })
})
