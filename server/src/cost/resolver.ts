import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface ClaudboardInstall {
  installPath: string
  version: string
  computeCostScript: string
}

interface PluginEntry {
  installPath?: unknown
  version?: unknown
}

interface InstalledPlugins {
  plugins?: Record<string, unknown>
}

function semverScore(version: string): number[] {
  if (version === 'unknown') return [-1, 0, 0, 0, 0]
  // Split on '-' to separate prerelease; prerelease < release
  const [main, pre] = version.split('-')
  const parts = (main ?? '').split('.').map((p) => parseInt(p, 10) || 0)
  const hasPre = pre != null ? 0 : 1  // release > prerelease
  // Extract numeric suffix from prerelease like "beta.11"
  const preNum = pre != null ? (parseInt(pre.replace(/\D+/g, ''), 10) || 0) : 0
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, hasPre, preNum]
}

function compareVersions(a: string, b: string): number {
  const sa = semverScore(a)
  const sb = semverScore(b)
  for (let i = 0; i < sa.length; i++) {
    const diff = (sa[i] ?? 0) - (sb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function resolveClaudboard(): ClaudboardInstall | null {
  const pluginsJsonPath = join(homedir(), '.claude', 'plugins', 'installed_plugins.json')
  let data: InstalledPlugins
  try {
    data = JSON.parse(readFileSync(pluginsJsonPath, 'utf8')) as InstalledPlugins
  } catch {
    return null
  }

  const entries = data?.plugins?.['claudboard@claudboard']
  if (!Array.isArray(entries) || entries.length === 0) return null

  const candidates = (entries as PluginEntry[])
    .filter((e): e is { installPath: string; version: string } =>
      typeof e.installPath === 'string' && typeof e.version === 'string'
    )
    .sort((a, b) => compareVersions(b.version, a.version))

  for (const candidate of candidates) {
    if (!existsSync(candidate.installPath)) continue
    return {
      installPath: candidate.installPath,
      version: candidate.version,
      computeCostScript: join(candidate.installPath, 'skills', 'claudboard', 'scripts', 'compute-cost.sh'),
    }
  }

  return null
}
