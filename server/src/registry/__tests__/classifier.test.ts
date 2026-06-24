import { classify } from '../classifier.js'
import type { ScanResult } from '../scanner.js'

describe('topology classifier', () => {
  test('single repo with .claude → monolith', () => {
    const scan: ScanResult = { gitRoot: '/repo', hasClaude: true, childRepos: [], hasMonorepoPackages: false }
    const result = classify('/repo', scan, new Map())
    expect(result.repos).toHaveLength(1)
    expect(result.repos[0]!.topology).toBe('monolith')
  })

  test('repo with packages/*/.claude → monorepo', () => {
    const scan: ScanResult = { gitRoot: '/repo', hasClaude: true, childRepos: [], hasMonorepoPackages: true }
    const result = classify('/repo', scan, new Map())
    expect(result.repos).toHaveLength(1)
    expect(result.repos[0]!.topology).toBe('monorepo')
  })

  test('multi-repo folder without .claude at root is classified as multi-repo-workspace', () => {
    const scan: ScanResult = { gitRoot: null, hasClaude: false, childRepos: ['/work/a', '/work/b'], hasMonorepoPackages: false }
    const childScans = new Map<string, ScanResult>([
      ['/work/a', { gitRoot: '/work/a', hasClaude: false, childRepos: [], hasMonorepoPackages: false }],
      ['/work/b', { gitRoot: '/work/b', hasClaude: false, childRepos: [], hasMonorepoPackages: false }],
    ])
    const result = classify('/work', scan, childScans)
    expect(result.repos).toHaveLength(1)
    expect(result.repos[0]!.path).toBe('/work')
    expect(result.repos[0]!.topology).toBe('multi-repo-workspace')
  })

  test('parent dir with meta-repo .claude + 2 child repos → 1 Project at workspace root', () => {
    const scan: ScanResult = { gitRoot: null, hasClaude: true, childRepos: ['/work/a', '/work/b', '/work/c'], hasMonorepoPackages: false }
    const childScans = new Map<string, ScanResult>([
      ['/work/a', { gitRoot: '/work/a', hasClaude: true, childRepos: [], hasMonorepoPackages: false }],
      ['/work/b', { gitRoot: '/work/b', hasClaude: true, childRepos: [], hasMonorepoPackages: false }],
      ['/work/c', { gitRoot: '/work/c', hasClaude: true, childRepos: [], hasMonorepoPackages: false }],
    ])
    const result = classify('/work', scan, childScans)
    expect(result.repos).toHaveLength(1)
    expect(result.repos[0]!.path).toBe('/work')
    expect(result.repos[0]!.topology).toBe('multi-repo-workspace')
  })

  test('parent dir with 3 child repos AND a workspace-meta child returns 1 Project at the root', () => {
    const scan: ScanResult = {
      gitRoot: null,
      hasClaude: true,
      childRepos: ['/work/repo-a', '/work/repo-b', '/work/repo-c', '/work/workspace-meta'],
      hasMonorepoPackages: false,
    }
    const childScans = new Map<string, ScanResult>([
      ['/work/repo-a', { gitRoot: '/work/repo-a', hasClaude: true, childRepos: [], hasMonorepoPackages: false }],
      ['/work/repo-b', { gitRoot: '/work/repo-b', hasClaude: true, childRepos: [], hasMonorepoPackages: false }],
      ['/work/repo-c', { gitRoot: '/work/repo-c', hasClaude: true, childRepos: [], hasMonorepoPackages: false }],
      ['/work/workspace-meta', { gitRoot: '/work/workspace-meta', hasClaude: true, childRepos: [], hasMonorepoPackages: false }],
    ])
    const result = classify('/work', scan, childScans)
    expect(result.repos).toHaveLength(1)
    expect(result.repos[0]!.path).toBe('/work')
    expect(result.repos[0]!.topology).toBe('multi-repo-workspace')
  })
})
