import type { Topology } from '@bosch-sdlc/protocol'
import { type ScanResult } from './scanner.js'

export interface ClassifiedRepo {
  path: string
  topology: Topology
}

export interface ClassifiedWorkspace {
  root: string
  repos: ClassifiedRepo[]
}

export function classify(rootDir: string, scan: ScanResult, childScans: Map<string, ScanResult>): ClassifiedWorkspace {
  const repos: ClassifiedRepo[] = []

  // Case 1: multi-repo-workspace — root has no .git and 2+ child repos (no .claude requirement)
  if (!scan.gitRoot && scan.childRepos.length >= 2) {
    repos.push({ path: rootDir, topology: 'multi-repo-workspace' })
    return { root: rootDir, repos }
  }

  // Case 2: root itself is a repo
  if (scan.gitRoot) {
    // Case 2a: monorepo — has .claude AND has packages/*/.claude or services/*/.claude
    if (scan.hasClaude && scan.hasMonorepoPackages) {
      repos.push({ path: rootDir, topology: 'monorepo' })
    } else {
      // Case 2b: monolith
      repos.push({ path: rootDir, topology: 'monolith' })
    }
    return { root: rootDir, repos }
  }

  // Case 3: single child repo or no child repos — attach the one child as monolith
  for (const childPath of scan.childRepos) {
    const childScan = childScans.get(childPath)
    if (!childScan?.gitRoot) continue
    repos.push({ path: childPath, topology: 'monolith' })
  }
  return { root: rootDir, repos }
}
