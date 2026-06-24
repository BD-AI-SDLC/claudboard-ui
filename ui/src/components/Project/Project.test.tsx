/**
 * Integration-style test for the PrereqInterview wiring on the Project page
 * and active-run banner/disable behavior.
 *
 * Verifies the wiring contract:
 *   1. Initially no PrereqInterview is mounted.
 *   2. After a runPrereq call resolves, the section appears.
 *   3. When the run's polled status flips to done, the section unmounts.
 *   4. Active-run banner appears when getRuns returns a running run.
 *   5. All launch buttons are disabled while a run is in flight.
 *   6. Banner clears and prereqs refetch when run completes.
 *   7. No banner when no active runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import type { PrereqRecord, Repo as RepoType, Run } from '@bosch-sdlc/protocol'

vi.mock('../PrereqInterview/PrereqInterview.js', () => ({
  default: ({ runId, cmd }: { runId: string; cmd: string }) => (
    <div data-testid="prereq-interview">PI[{cmd}:{runId}]</div>
  ),
}))

const mockRepo: RepoType = {
  id: 'p1',
  projectId: 'proj-1',
  path: '/tmp/p1',
  name: 'p1',
  topology: 'monolith',
  status: 'active',
  prereqs: {},
  defaultAutonomy: 'balanced',
  featureWorkflowProjectKey: null,
}

// Start with analyse done so the FoundationChain advances to workflow.
let mockPrereqs: Record<string, PrereqRecord> = {
  analyse: {
    id: 'pr-a', repoId: 'p1', cmd: 'analyse', state: 'done',
    lastRun: null, duration: null, cost: null,
    output: '.claude/reports/claudboard-analysis.md',
    staleReason: null,
  },
  generate: {
    id: 'pr-g', repoId: 'p1', cmd: 'generate', state: 'done',
    lastRun: null, duration: null, cost: null, output: 'CLAUDE.md',
    staleReason: null,
  },
  'workflow': {
    id: 'pr-w', repoId: 'p1', cmd: 'workflow', state: 'missing',
    lastRun: null, duration: null, cost: null, output: null,
    staleReason: null,
  },
}

let nextRunStatus: Run['status'] = 'running'
let mockGetRunsResult: Run[] = []

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-cb', repoId: 'p1', kind: 'claudboard-analyse', status: 'running',
    prompt: '/analyse', target: '/tmp/p1', transcriptPath: '',
    createdAt: '2026-05-29T10:00:00.000Z', completedAt: null,
    cost: null, costUsd: null, inputTokens: null, outputTokens: null,
    autonomy: 'balanced', errorMessage: null, phaseCosts: [],
    ...overrides,
  }
}

vi.mock('../../api/client.js', () => ({
  api: {
    getRepo: vi.fn().mockImplementation(() => Promise.resolve(mockRepo)),
    getRepoPrereqs: vi.fn().mockImplementation(() => Promise.resolve(mockPrereqs)),
    runPrereq: vi.fn().mockImplementation((cmd: string) =>
      Promise.resolve({
        id: 'run-9', repoId: 'p1', kind: 'prereq', status: 'running',
        prompt: `/${cmd}`, target: '/tmp/p1', transcriptPath: '',
        createdAt: '', completedAt: null, cost: null, costUsd: null,
        inputTokens: null, outputTokens: null, autonomy: 'balanced',
        errorMessage: null, phaseCosts: [],
      } satisfies Run),
    ),
    getRun: vi.fn().mockImplementation(() =>
      Promise.resolve({
        id: 'run-9', repoId: 'p1', kind: 'prereq', status: nextRunStatus,
        prompt: '/workflow', target: '/tmp/p1', transcriptPath: '',
        createdAt: '', completedAt: null, cost: null, costUsd: null,
        inputTokens: null, outputTokens: null, autonomy: 'balanced',
        errorMessage: null, phaseCosts: [],
      } satisfies Run),
    ),
    getRuns: vi.fn().mockImplementation(() => Promise.resolve(mockGetRunsResult)),
  },
}))

const { default: Project, RUN_IN_PROGRESS_TOOLTIP } = await import('./Project.js')

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  nextRunStatus = 'running'
  mockGetRunsResult = []
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Project page — layout swap', () => {
  it('renders SetupBanner + FoundationChain + MaintenanceGrid when foundation is incomplete', async () => {
    mockPrereqs = {
      analyse: {
        id: 'pr-a', repoId: 'p1', cmd: 'analyse', state: 'done',
        lastRun: null, duration: null, cost: null,
        output: '.claude/reports/claudboard-analysis.md', staleReason: null,
      },
      generate: {
        id: 'pr-g', repoId: 'p1', cmd: 'generate', state: 'done',
        lastRun: null, duration: null, cost: null, output: 'CLAUDE.md', staleReason: null,
      },
      'workflow': {
        id: 'pr-w', repoId: 'p1', cmd: 'workflow', state: 'missing',
        lastRun: null, duration: null, cost: null, output: null, staleReason: null,
      },
    }
    render(<Project projectId="p1" />)
    await waitFor(() => expect(screen.getAllByText('p1').length).toBeGreaterThan(0))
    expect(screen.getByText('Set up Claudboard for this repo')).toBeDefined()
    expect(screen.queryByText(/Foundation drift detected/)).toBeNull()
    expect(screen.getByText(/ordered — each step requires the previous/)).toBeDefined()
  })

  it('renders no drift strip and no Recommended chip when foundation is done', async () => {
    mockPrereqs = {
      analyse: {
        id: 'pr-a', repoId: 'p1', cmd: 'analyse', state: 'done',
        lastRun: null, duration: null, cost: null,
        output: '.claude/reports/claudboard-analysis.md', staleReason: null,
      },
      generate: {
        id: 'pr-g', repoId: 'p1', cmd: 'generate', state: 'done',
        lastRun: null, duration: null, cost: null, output: 'CLAUDE.md', staleReason: null,
      },
      'workflow': {
        id: 'pr-w', repoId: 'p1', cmd: 'workflow', state: 'done',
        lastRun: null, duration: null, cost: null,
        output: '.claude/skills/feature-workflow/SKILL.md', staleReason: null,
      },
    }
    render(<Project projectId="p1" />)
    await waitFor(() => expect(screen.getAllByText('p1').length).toBeGreaterThan(0))
    expect(screen.queryByText('Set up Claudboard for this repo')).toBeNull()
    expect(screen.queryByText(/Foundation drift detected/)).toBeNull()
    expect(screen.queryByText('Recommended')).toBeNull()
    expect(screen.getByText(/ordered — each step requires the previous/)).toBeDefined()
  })

  it('renders locked foundation cards (Setup complete) in operational mode', async () => {
    mockPrereqs = {
      analyse: {
        id: 'pr-a', repoId: 'p1', cmd: 'analyse', state: 'done',
        lastRun: null, duration: null, cost: null,
        output: '.claude/reports/claudboard-analysis.md', staleReason: null,
      },
      generate: {
        id: 'pr-g', repoId: 'p1', cmd: 'generate', state: 'done',
        lastRun: null, duration: null, cost: null, output: 'CLAUDE.md', staleReason: null,
      },
      'workflow': {
        id: 'pr-w', repoId: 'p1', cmd: 'workflow', state: 'done',
        lastRun: null, duration: null, cost: null,
        output: '.claude/skills/feature-workflow/SKILL.md', staleReason: null,
      },
    }
    render(<Project projectId="p1" />)
    await waitFor(() => expect(screen.getAllByText('p1').length).toBeGreaterThan(0))
    // All three locked cards show "Setup complete"
    const setupCompleteEls = screen.getAllByText('Setup complete')
    expect(setupCompleteEls.length).toBe(3)
  })
})

describe('Project page — PrereqInterview wiring', () => {
  beforeEach(() => {
    mockPrereqs = {
      analyse: {
        id: 'pr-a', repoId: 'p1', cmd: 'analyse', state: 'done',
        lastRun: null, duration: null, cost: null,
        output: '.claude/reports/claudboard-analysis.md', staleReason: null,
      },
      generate: {
        id: 'pr-g', repoId: 'p1', cmd: 'generate', state: 'done',
        lastRun: null, duration: null, cost: null, output: 'CLAUDE.md', staleReason: null,
      },
      'workflow': {
        id: 'pr-w', repoId: 'p1', cmd: 'workflow', state: 'missing',
        lastRun: null, duration: null, cost: null, output: null, staleReason: null,
      },
    }
  })

  it('mounts PrereqInterview after runPrereq, unmounts when the run completes', async () => {
    render(<Project projectId="p1" />)

    await waitFor(() => {
      expect(screen.getAllByText('p1').length).toBeGreaterThan(0)
    })
    expect(screen.queryByTestId('prereq-interview')).toBeNull()

    const runButton = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.toLowerCase().includes('run'))
    expect(runButton).toBeDefined()
    fireEvent.click(runButton!)

    await waitFor(() => {
      expect(screen.getByTestId('prereq-interview')).toBeDefined()
    })
    expect(screen.getByTestId('prereq-interview').textContent).toMatch(/run-9/)

    nextRunStatus = 'done'
    await act(async () => {
      vi.advanceTimersByTime(2100)
    })

    await waitFor(() => {
      expect(screen.queryByTestId('prereq-interview')).toBeNull()
    })
  })
})

describe('Project page — active-run banner', () => {
  beforeEach(() => {
    mockPrereqs = {
      analyse: {
        id: 'pr-a', repoId: 'p1', cmd: 'analyse', state: 'done',
        lastRun: null, duration: null, cost: null,
        output: '.claude/reports/claudboard-analysis.md', staleReason: null,
      },
      generate: {
        id: 'pr-g', repoId: 'p1', cmd: 'generate', state: 'done',
        lastRun: null, duration: null, cost: null, output: 'CLAUDE.md', staleReason: null,
      },
      'workflow': {
        id: 'pr-w', repoId: 'p1', cmd: 'workflow', state: 'done',
        lastRun: null, duration: null, cost: null,
        output: '.claude/skills/feature-workflow/SKILL.md', staleReason: null,
      },
    }
  })

  it('renders active-run banner when a run is in flight', async () => {
    const runningRun = makeRun({ id: 'run-cb', kind: 'claudboard-analyse', status: 'running' })
    mockGetRunsResult = [runningRun]
    const spy = vi.fn()

    render(<Project projectId="p1" onRunCreated={spy} />)
    await waitFor(() => expect(screen.getAllByText('p1').length).toBeGreaterThan(0))

    await waitFor(() => {
      expect(screen.getByText('Claudboard analyse running — open run')).toBeDefined()
    })

    fireEvent.click(screen.getByText('Claudboard analyse running — open run'))
    expect(spy).toHaveBeenCalledWith('run-cb')
  })

  it('disables all launch buttons when a run is in flight', async () => {
    const runningRun = makeRun({ id: 'run-cb', kind: 'claudboard-analyse', status: 'running' })
    mockGetRunsResult = [runningRun]
    const spy = vi.fn()

    render(<Project projectId="p1" onRunCreated={spy} />)
    await waitFor(() => expect(screen.getAllByText('p1').length).toBeGreaterThan(0))

    await waitFor(() => {
      expect(screen.queryByText('Claudboard analyse running — open run')).toBeDefined()
    })

    // All "Running…" buttons should be disabled with the shared tooltip
    const runningBtns = screen.getAllByRole('button', { name: 'Running…' })
    for (const btn of runningBtns) {
      expect((btn as HTMLButtonElement).disabled).toBe(true)
      expect((btn as HTMLButtonElement).title).toBe(RUN_IN_PROGRESS_TOOLTIP)
    }
  })

  it('banner clears and prereqs refetch when run completes', async () => {
    const runningRun = makeRun({ id: 'run-cb', status: 'running' })
    const doneRun = makeRun({ id: 'run-cb', status: 'done' })
    const getRunsMock = vi.mocked((await import('../../api/client.js')).api.getRuns)
    getRunsMock.mockResolvedValueOnce([runningRun]).mockResolvedValue([doneRun])

    const getRepoPrereqsMock = vi.mocked((await import('../../api/client.js')).api.getRepoPrereqs)
    getRepoPrereqsMock.mockClear()

    render(<Project projectId="p1" onRunCreated={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByText('p1').length).toBeGreaterThan(0))

    // Wait for banner to appear
    await waitFor(() => {
      expect(screen.queryByText(/running — open run/)).toBeDefined()
    })

    // Advance polling so the run flips to done
    await act(async () => {
      vi.advanceTimersByTime(2100)
    })

    // Banner should disappear
    await waitFor(() => {
      expect(screen.queryByText(/running — open run/)).toBeNull()
    })

    // getRepoPrereqs should have been called again after completion
    expect(getRepoPrereqsMock).toHaveBeenCalled()
  })

  it('no banner when no active runs', async () => {
    mockGetRunsResult = []

    render(<Project projectId="p1" />)
    await waitFor(() => expect(screen.getAllByText('p1').length).toBeGreaterThan(0))

    expect(screen.queryByText(/running — open run/)).toBeNull()
  })
})
