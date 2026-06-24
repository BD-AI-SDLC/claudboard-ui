import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import type { Run, RunStatus } from '@bosch-sdlc/protocol'
import RunControlCluster from './RunControlCluster.js'

const stopRun = vi.fn()
const pauseRun = vi.fn()
const resumeRun = vi.fn()

vi.mock('../../api/client.js', () => ({
  api: {
    stopRun: (...args: unknown[]) => stopRun(...args),
    pauseRun: (...args: unknown[]) => pauseRun(...args),
    resumeRun: (...args: unknown[]) => resumeRun(...args),
  },
}))

vi.mock('../primitives/Icon.js', () => ({
  default: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}))

function makeRun(status: RunStatus, kind: Run['kind'] = 'feature'): Run {
  return {
    id: 'r1',
    repoId: 'repo1',
    kind,
    status,
    prompt: 'do thing',
    target: '/repo',
    transcriptPath: '/tmp/t.jsonl',
    createdAt: '2026-05-29T10:00:00Z',
    completedAt: null,
    cost: null,
    costUsd: null,
    inputTokens: null,
    outputTokens: null,
    autonomy: 'balanced',
    errorMessage: null,
    phaseCosts: [],
  }
}

describe('RunControlCluster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stopRun.mockResolvedValue(undefined)
    pauseRun.mockResolvedValue(undefined)
    resumeRun.mockResolvedValue(undefined)
  })
  afterEach(() => cleanup())

  it('renders nothing when run is null', () => {
    const { container } = render(<RunControlCluster runId="r1" run={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for prereq runs', () => {
    const { container } = render(<RunControlCluster runId="r1" run={makeRun('running', 'prereq')} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders Pause + Stop + Restart for a running feature run', () => {
    const onRestart = vi.fn()
    render(<RunControlCluster runId="r1" run={makeRun('running')} onRestart={onRestart} />)
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy()
  })

  it('hides Stop for terminal statuses but keeps Restart', () => {
    const onRestart = vi.fn()
    for (const s of ['done', 'failed', 'dead', 'cancelled'] as const) {
      cleanup()
      render(<RunControlCluster runId="r1" run={makeRun(s as RunStatus)} onRestart={onRestart} />)
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy()
    }
  })

  it('clicking Stop opens a popover; clicking "Stop run" calls api.stopRun once', async () => {
    render(<RunControlCluster runId="r1" run={makeRun('running')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Stop run?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop run' }))
    await waitFor(() => expect(stopRun).toHaveBeenCalledTimes(1))
    expect(stopRun).toHaveBeenCalledWith('r1')
  })

  it('clicking Stop then Cancel dismisses popover without calling stopRun', () => {
    render(<RunControlCluster runId="r1" run={makeRun('running')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(stopRun).not.toHaveBeenCalled()
  })

  it('clicking Restart on a terminal run calls onRestart immediately, no popover', () => {
    const onRestart = vi.fn()
    render(<RunControlCluster runId="r1" run={makeRun('failed')} onRestart={onRestart} />)
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    expect(onRestart).toHaveBeenCalledWith('r1')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('clicking Restart on a live run opens the 3-way popover', () => {
    const onRestart = vi.fn()
    render(<RunControlCluster runId="r1" run={makeRun('running')} onRestart={onRestart} />)
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop and restart' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start alongside' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(onRestart).not.toHaveBeenCalled()
  })

  it('"Start alongside" calls onRestart without calling stopRun', () => {
    const onRestart = vi.fn()
    render(<RunControlCluster runId="r1" run={makeRun('running')} onRestart={onRestart} />)
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start alongside' }))
    expect(onRestart).toHaveBeenCalledWith('r1')
    expect(stopRun).not.toHaveBeenCalled()
  })

  it('"Stop and restart" calls stopRun then onRestart in order', async () => {
    const onRestart = vi.fn()
    render(<RunControlCluster runId="r1" run={makeRun('running')} onRestart={onRestart} />)
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop and restart' }))
    await waitFor(() => expect(onRestart).toHaveBeenCalledWith('r1'))
    expect(stopRun).toHaveBeenCalledWith('r1')
    // ordering: stopRun is invoked before the await resolves; onRestart is called after
    const stopCallOrder = stopRun.mock.invocationCallOrder[0]!
    const restartCallOrder = onRestart.mock.invocationCallOrder[0]!
    expect(stopCallOrder).toBeLessThan(restartCallOrder)
  })

  it('Restart is not rendered when onRestart prop is absent', () => {
    render(<RunControlCluster runId="r1" run={makeRun('running')} />)
    expect(screen.queryByRole('button', { name: 'Restart' })).toBeNull()
  })

  it('Stop network failure surfaces inline error for 4 seconds, then clears', async () => {
    vi.useFakeTimers()
    try {
      stopRun.mockRejectedValue(new Error('boom'))
      render(<RunControlCluster runId="r1" run={makeRun('running')} />)
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop run' })) })
      expect(screen.getByRole('alert').textContent).toBe('boom')
      await act(async () => { vi.advanceTimersByTime(4000) })
      expect(screen.queryByRole('alert')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
