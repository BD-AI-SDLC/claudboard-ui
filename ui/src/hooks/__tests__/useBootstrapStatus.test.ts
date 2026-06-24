import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const mockGetBootstrapStatus = vi.fn<() => Promise<{ state: string; message?: string }>>()
const mockRetryBootstrap = vi.fn<() => Promise<{ state: string; message?: string }>>()

vi.mock('../../api/client.js', () => ({
  api: {
    getBootstrapStatus: mockGetBootstrapStatus,
    retryBootstrap: mockRetryBootstrap,
  },
}))

const { useBootstrapStatus } = await import('../useBootstrapStatus.js')

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  mockGetBootstrapStatus.mockReset()
  mockRetryBootstrap.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useBootstrapStatus', () => {
  it('seeds initial state from REST and stops polling when ready', async () => {
    mockGetBootstrapStatus.mockResolvedValueOnce({ state: 'ready' })

    const { result } = renderHook(() => useBootstrapStatus())

    await waitFor(() => {
      expect(result.current.status.state).toBe('ready')
    })
    // After settling, advance time and confirm no additional fetches
    mockGetBootstrapStatus.mockClear()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(mockGetBootstrapStatus).not.toHaveBeenCalled()
  })

  it('polls while installing and transitions to ready', async () => {
    mockGetBootstrapStatus
      .mockResolvedValueOnce({ state: 'installing' })
      .mockResolvedValueOnce({ state: 'installing' })
      .mockResolvedValueOnce({ state: 'ready' })

    const { result } = renderHook(() => useBootstrapStatus())

    await waitFor(() => {
      expect(result.current.status.state).toBe('installing')
    })

    // Advance through two poll intervals to land on 'ready'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_600)
      await vi.advanceTimersByTimeAsync(1_600)
    })

    await waitFor(() => {
      expect(result.current.status.state).toBe('ready')
    })
  })

  it('stops polling on cli-missing (terminal)', async () => {
    mockGetBootstrapStatus.mockResolvedValue({ state: 'cli-missing', message: 'install claude' })

    const { result } = renderHook(() => useBootstrapStatus())

    await waitFor(() => {
      expect(result.current.status.state).toBe('cli-missing')
    })

    mockGetBootstrapStatus.mockClear()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(mockGetBootstrapStatus).not.toHaveBeenCalled()
  })

  it('exposes install-failed message and supports retry', async () => {
    mockGetBootstrapStatus.mockResolvedValueOnce({ state: 'install-failed', message: 'network broken' })
    mockRetryBootstrap.mockResolvedValueOnce({ state: 'installing' })

    const { result } = renderHook(() => useBootstrapStatus())

    await waitFor(() => {
      expect(result.current.status).toEqual({ state: 'install-failed', message: 'network broken' })
    })

    await act(async () => {
      await result.current.retry()
    })

    expect(mockRetryBootstrap).toHaveBeenCalledTimes(1)
    expect(result.current.status.state).toBe('installing')
  })
})
