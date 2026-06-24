import { readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface ScanResult {
  gitRoot: string | null
  hasClaude: boolean
  childRepos: string[]  // absolute paths of child dirs that have .git
  hasMonorepoPackages: boolean  // has packages/*/.claude or services/*/.claude
}

export function scanDirectory(dir: string): ScanResult {
  const hasGit = existsSync(join(dir, '.git'))
  const hasClaude = existsSync(join(dir, '.claude'))

  const childRepos: string[] = []
  let hasMonorepoPackages = false

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const childPath = join(dir, entry.name)
      if (existsSync(join(childPath, '.git'))) {
        childRepos.push(childPath)
      }
      // check for monorepo sub-package pattern: packages/*/.claude or services/*/.claude
      if (entry.name === 'packages' || entry.name === 'services') {
        try {
          const subEntries = readdirSync(childPath, { withFileTypes: true })
          for (const sub of subEntries) {
            if (sub.isDirectory() && existsSync(join(childPath, sub.name, '.claude'))) {
              hasMonorepoPackages = true
            }
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore unreadable dirs */ }

  return {
    gitRoot: hasGit ? dir : null,
    hasClaude,
    childRepos,
    hasMonorepoPackages,
  }
}
