import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import type { Run, WsEvent } from '@bosch-sdlc/protocol'

const mockGetRun = vi.fn<(id: string) => Promise<Run>>()
let mockEvents: WsEvent[] = []

vi.mock('../../api/client.js', () => ({
  api: {
    getRun: (...args: unknown[]) => mockGetRun(...(args as [string])),
    getRunEvents: vi.fn().mockResolvedValue([]),
    pauseRun: vi.fn().mockResolvedValue(undefined),
    resumeRun: vi.fn().mockResolvedValue(undefined),
    resolveGate: vi.fn().mockResolvedValue({}),
  },
}))

vi.mock('../../hooks/useRunStream.js', () => ({
  useRunStream: () => ({ events: mockEvents, hydrated: true }),
}))

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'r1', repoId: 'p1', kind: 'claudboard-analyse', status: 'running',
    prompt: '/analyse', target: '/tmp', transcriptPath: '',
    createdAt: '2026-05-29T10:00:00.000Z', completedAt: null,
    cost: null, costUsd: null, inputTokens: null, outputTokens: null,
    autonomy: 'balanced', errorMessage: null, phaseCosts: [],
    ...overrides,
  }
}

const { default: ActiveRun } = await import('./ActiveRun.js')

const PHASE_TEMPLATE_TITLES = [
  'Ticket · Clarify · Specify · Plan',
  'Create Branch',
  'Develop and Test',
  'Commit',
  'Review',
  'PR Creation',
  'Finalize JIRA',
]

beforeEach(() => {
  mockGetRun.mockReset()
  mockEvents = []
})

afterEach(() => {
  cleanup()
})

describe('ActiveRun — kind-aware pipeline', () => {
  it('shows CLI run placeholder and no feature-workflow phases for claudboard-analyse runs', async () => {
    mockGetRun.mockResolvedValue(makeRun({ kind: 'claudboard-analyse' }))

    render(<ActiveRun runId="r1" />)

    // Wait for getRun to resolve and run.kind to be set
    await waitFor(() => {
      expect(screen.getByText('CLI run · see stream →')).toBeTruthy()
    })

    for (const title of PHASE_TEMPLATE_TITLES) {
      expect(screen.queryByText(title)).toBeNull()
    }
  })
})

describe('ActiveRun — Cost rail section', () => {
  it('renders Total and per-phase rows from cost-update events', async () => {
    mockGetRun.mockResolvedValue(makeRun({ kind: 'claudboard-analyse', status: 'done' }))
    mockEvents = [
      {
        run_id: 'r1', t: '2026-06-04T10:00:01Z', kind: 'cost-update',
        payload: { scope: 'phase', phaseNum: 1, phaseTitle: 'Analyse', costUsd: 0.42, inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, apiCalls: 2, model: 'claude-opus-4-7' },
      },
      {
        run_id: 'r1', t: '2026-06-04T10:00:02Z', kind: 'cost-update',
        payload: { scope: 'total', costUsd: 2.78, inputTokens: 200, outputTokens: 80, cacheReadTokens: 10, apiCalls: 5, model: 'claude-opus-4-7' },
      },
    ] as WsEvent[]

    render(<ActiveRun runId="r1" />)

    await waitFor(() => {
      expect(screen.getByText('Cost')).toBeTruthy()
    })

    expect(screen.getByText('$2.78')).toBeTruthy()
    expect(screen.getByText('$0.42')).toBeTruthy()
    expect(screen.getByText(/1 · Analyse/)).toBeTruthy()
  })

  it('hides Cost section when no cost data exists', async () => {
    mockGetRun.mockResolvedValue(makeRun({ kind: 'claudboard-analyse', costUsd: null, phaseCosts: [] }))
    mockEvents = []

    render(<ActiveRun runId="r1" />)

    await waitFor(() => {
      // Wait for the run to load
      expect(mockGetRun).toHaveBeenCalled()
    })

    expect(screen.queryByText('Cost')).toBeNull()
  })
})
