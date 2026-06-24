import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Run, Repo } from '@bosch-sdlc/protocol'
import RecentRunsPanel from './RecentRunsPanel.js'

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'r1', repoId: 'repo1', kind: 'feature', status: 'done',
    prompt: 'add feature', target: '/tmp', transcriptPath: '',
    createdAt: '2026-06-04T10:00:00.000Z', completedAt: '2026-06-04T10:05:00.000Z',
    cost: null, costUsd: null, inputTokens: null, outputTokens: null,
    autonomy: 'balanced', errorMessage: null, phaseCosts: [],
    ...overrides,
  }
}

const repo: Repo = {
  id: 'repo1', projectId: 'p1', path: '/tmp/repo', name: 'myrepo',
  topology: 'monolith', status: 'active',
  prereqs: {}, defaultAutonomy: 'balanced', featureWorkflowProjectKey: null,
}

describe('RecentRunsPanel — cost column', () => {
  it('renders $X.XX when run has costUsd', () => {
    render(
      <RecentRunsPanel
        runs={[makeRun({ costUsd: 4.23 })]}
        repos={[repo]}
        onOpenRun={() => {}}
      />
    )
    expect(screen.getByText('$4.23')).toBeTruthy()
  })

  it('renders em-dash when completed run has null costUsd', () => {
    render(
      <RecentRunsPanel
        runs={[makeRun({ status: 'done', costUsd: null })]}
        repos={[repo]}
        onOpenRun={() => {}}
      />
    )
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('renders skeleton placeholder when running run has null costUsd', () => {
    render(
      <RecentRunsPanel
        runs={[makeRun({ status: 'running', costUsd: null, completedAt: null })]}
        repos={[repo]}
        onOpenRun={() => {}}
      />
    )
    expect(screen.getByText('…')).toBeTruthy()
  })
})
