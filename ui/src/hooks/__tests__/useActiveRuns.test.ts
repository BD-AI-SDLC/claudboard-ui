import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { Run } from '@bosch-sdlc/protocol'

const mockGetRuns = vi.fn<(projectId: string) => Promise<Run[]>>()

vi.mock('../../api/client.js', () => ({
  api: { getRuns: mockGetRuns },
}))

const { useActiveRuns } = await import('../useActiveRuns.js')

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'r1', repoId: 'p1', kind: 'feature', status: 'running',
    prompt: '/start', target: '/tmp', transcriptPath: '',
    createdAt: '2026-01-01T10:00:00.000Z', completedAt: null,
    cost: null, costUsd: null, inputTokens: null, outputTokens: null,
    autonomy: 'balanced', errorMessage: null, phaseCosts: [],
    ...overrides,
  }
}

let originalVisibilityState: PropertyDescriptor | undefined

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  mockGetRuns.mockReset()
  originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState')
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
  if (originalVisibilityState) {
    Object.defineProperty(document, 'visibilityState', originalVisibilityState)
  }
})

describe('useActiveRuns', () => {
  it('(a) no runs → hasActive false, primary null', async () => {
    mockGetRuns.mockResolvedValue([])
    const { result } = renderHook(() => useActiveRuns('p1'))
    await waitFor(() => {
      expect(result.current.hasActive).toBe(false)
      expect(result.current.primary).toBeNull()
      expect(result.current.activeRuns).toHaveLength(0)
    })
  })

  it('(b) one running run → hasActive true, primary is that run', async () => {
    const run = makeRun({ id: 'r1', status: 'running' })
    mockGetRuns.mockResolvedValue([run])
    const { result } = renderHook(() => useActiveRuns('p1'))
    await waitFor(() => {
      expect(result.current.hasActive).toBe(true)
      expect(result.current.primary?.id).toBe('r1')
    })
  })

  it('(c) two running runs → primary is the newer one (createdAt desc)', async () => {
    const older = makeRun({ id: 'r-old', status: 'running', createdAt: '2026-01-01T09:00:00.000Z' })
    const newer = makeRun({ id: 'r-new', status: 'running', createdAt: '2026-01-01T10:00:00.000Z' })
    mockGetRuns.mockResolvedValue([older, newer])
    const { result } = renderHook(() => useActiveRuns('p1'))
    await waitFor(() => {
      expect(result.current.primary?.id).toBe('r-new')
    })
  })

  it('(d) interval pauses when hidden and resumes when visible', async () => {
    const run = makeRun()
    mockGetRuns.mockResolvedValue([run])

    const { result } = renderHook(() => useActiveRuns('p1'))
    await waitFor(() => expect(result.current.hasActive).toBe(true))

    const callCountAfterMount = mockGetRuns.mock.calls.length

    // Hide the tab → interval should stop
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    // No additional polls while hidden
    expect(mockGetRuns.mock.calls.length).toBe(callCountAfterMount)

    // Show the tab → interval restarts
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100)
    })
    expect(mockGetRuns.mock.calls.length).toBeGreaterThan(callCountAfterMount)
  })

  it('(e) cleanup clears interval and visibility listener on unmount', async () => {
    mockGetRuns.mockResolvedValue([])
    const { unmount } = renderHook(() => useActiveRuns('p1'))
    await waitFor(() => {})

    const callCountBeforeUnmount = mockGetRuns.mock.calls.length
    unmount()

    // Advance time — no more fetches after unmount
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    expect(mockGetRuns.mock.calls.length).toBe(callCountBeforeUnmount)

    // Dispatching visibilitychange after unmount should not throw or refetch
    document.dispatchEvent(new Event('visibilitychange'))
    expect(mockGetRuns.mock.calls.length).toBe(callCountBeforeUnmount)
  })
})
