import { jest } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { readFeatureWorkflowProjectKey } = await import('../project-config.js')

function makeRepoWithConfig(config: unknown | undefined): string {
  const repoDir = join(tmpdir(), `bosch-project-config-test-${randomUUID()}`)
  mkdirSync(repoDir, { recursive: true })
  if (config !== undefined) {
    const skillDir = join(repoDir, '.claude', 'skills', 'feature-workflow')
    mkdirSync(skillDir, { recursive: true })
    const payload = typeof config === 'string' ? config : JSON.stringify(config)
    writeFileSync(join(skillDir, 'config.json'), payload, 'utf-8')
  }
  return repoDir
}

describe('readFeatureWorkflowProjectKey', () => {
  const created: string[] = []
  function fresh(config: unknown | undefined): string {
    const dir = makeRepoWithConfig(config)
    created.push(dir)
    return dir
  }

  afterAll(() => {
    for (const dir of created) {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
    }
  })

  it('returns null when the config file is missing', () => {
    const dir = fresh(undefined)
    expect(readFeatureWorkflowProjectKey(dir)).toBeNull()
  })

  it('returns null and warns when the file is not valid JSON', () => {
    const dir = fresh('{ this is not json')
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(readFeatureWorkflowProjectKey(dir)).toBeNull()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]![0]).toContain('Failed to parse')
    warnSpy.mockRestore()
  })

  it('returns null when tracker field is missing', () => {
    const dir = fresh({ jira: { projectKey: 'PLAT' } })
    expect(readFeatureWorkflowProjectKey(dir)).toBeNull()
  })

  it('returns null when tracker is an unknown value (e.g. "github")', () => {
    const dir = fresh({ tracker: 'github', jira: { projectKey: 'PLAT' } })
    expect(readFeatureWorkflowProjectKey(dir)).toBeNull()
  })

  it('returns the jira project key when tracker is "jira"', () => {
    const dir = fresh({ tracker: 'jira', jira: { projectKey: 'PLAT' } })
    expect(readFeatureWorkflowProjectKey(dir)).toBe('PLAT')
  })

  it('returns null when jira.projectKey is the __stub__ sentinel', () => {
    const dir = fresh({ tracker: 'jira', jira: { projectKey: '__stub__' } })
    expect(readFeatureWorkflowProjectKey(dir)).toBeNull()
  })

  it('returns null when jira.projectKey is an un-substituted TODO template', () => {
    const dir = fresh({ tracker: 'jira', jira: { projectKey: '[TODO: JIRA_PROJECT_KEY]' } })
    expect(readFeatureWorkflowProjectKey(dir)).toBeNull()
  })

  it('returns null when jira.projectKey is an empty string', () => {
    const dir = fresh({ tracker: 'jira', jira: { projectKey: '' } })
    expect(readFeatureWorkflowProjectKey(dir)).toBeNull()
  })

  it('returns null when tracker is "jira" but the jira block is missing entirely', () => {
    const dir = fresh({ tracker: 'jira' })
    expect(readFeatureWorkflowProjectKey(dir)).toBeNull()
  })

  it('does not fall back to tr.projectKey when tracker is "jira"', () => {
    const dir = fresh({ tracker: 'jira', tr: { projectKey: 'TR-FALLBACK' } })
    expect(readFeatureWorkflowProjectKey(dir)).toBeNull()
  })

  it('returns the tr project key when tracker is "tr"', () => {
    const dir = fresh({ tracker: 'tr', tr: { projectKey: 'TR-CHARLIE' } })
    expect(readFeatureWorkflowProjectKey(dir)).toBe('TR-CHARLIE')
  })

  it('returns null when tracker is "tr" but tr.projectKey is missing', () => {
    const dir = fresh({ tracker: 'tr', tr: {} })
    expect(readFeatureWorkflowProjectKey(dir)).toBeNull()
  })

  it('returns null when projectKey is a non-string value', () => {
    const dir = fresh({ tracker: 'jira', jira: { projectKey: 42 } })
    expect(readFeatureWorkflowProjectKey(dir)).toBeNull()
  })
})
