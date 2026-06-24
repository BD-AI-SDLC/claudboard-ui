import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface CostJson {
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  apiCalls: number
  model: string
}

interface RawCostOutput {
  total_usd?: unknown
  model?: unknown
  api_calls?: unknown
  tokens?: {
    input_uncached?: unknown
    output?: unknown
    cache_read?: unknown
  }
}

export function sessionJsonlPath(cwd: string, sessionId: string): string {
  // Mirror Claude Code's own slug rule: collapse any run of non-[A-Za-z0-9-]
  // characters to a single '-'. This handles paths containing '.', spaces,
  // etc. — which the older `cwd.replaceAll('/', '-')` got wrong.
  const slug = cwd.replace(/[^A-Za-z0-9-]+/g, '-')
  return join(homedir(), '.claude', 'projects', slug, `${sessionId}.jsonl`)
}

function findSessionJsonlByGlob(sessionId: string): string | null {
  const projectsDir = join(homedir(), '.claude', 'projects')
  let dirs: string[]
  try {
    dirs = readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return null
  }
  for (const dir of dirs) {
    const candidate = join(projectsDir, dir, `${sessionId}.jsonl`)
    if (existsSync(candidate)) return candidate
  }
  return null
}

export interface ComputeCostOptions {
  scriptPath: string | null
  sessionJsonl: string
  since: string
  until?: string
}

export function computeCost(opts: ComputeCostOptions): Promise<CostJson | null> {
  if (!opts.scriptPath) return Promise.resolve(null)

  // Fast path: use the regex-derived path. If it doesn't exist, fall back to
  // a glob by sessionId across ~/.claude/projects/*. Guards against any drift
  // between our slug derivation and Claude Code's.
  let resolvedJsonl = opts.sessionJsonl
  if (!existsSync(resolvedJsonl)) {
    const sessionId = opts.sessionJsonl.split('/').pop()?.replace(/\.jsonl$/, '') ?? ''
    const fallback = sessionId ? findSessionJsonlByGlob(sessionId) : null
    if (!fallback) return Promise.resolve(null)
    resolvedJsonl = fallback
  }

  return new Promise((resolve) => {
    const args: string[] = ['--format', 'json', '--since', opts.since]
    if (opts.until) args.push('--until', opts.until)
    args.push(resolvedJsonl)

    let stdout = ''
    let settled = false

    const child = spawn(opts.scriptPath!, args, { stdio: ['ignore', 'pipe', 'ignore'] })

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.once('error', () => {
      if (!settled) { settled = true; resolve(null) }
    })

    child.once('close', (code) => {
      if (settled) return
      settled = true
      if (code !== 0) { resolve(null); return }
      try {
        const raw = JSON.parse(stdout) as RawCostOutput
        const tokens = raw.tokens ?? {}
        resolve({
          costUsd: typeof raw.total_usd === 'number' ? raw.total_usd : 0,
          inputTokens: typeof tokens.input_uncached === 'number' ? tokens.input_uncached : 0,
          outputTokens: typeof tokens.output === 'number' ? tokens.output : 0,
          cacheReadTokens: typeof tokens.cache_read === 'number' ? tokens.cache_read : 0,
          apiCalls: typeof raw.api_calls === 'number' ? raw.api_calls : 0,
          model: typeof raw.model === 'string' ? raw.model : '',
        })
      } catch {
        resolve(null)
      }
    })
  })
}
