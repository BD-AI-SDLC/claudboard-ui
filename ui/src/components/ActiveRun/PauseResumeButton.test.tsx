import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import type { RunStatus } from '@bosch-sdlc/protocol'
import PauseResumeButton from './PauseResumeButton.js'

const pauseRun = vi.fn()
const resumeRun = vi.fn()

vi.mock('../../api/client.js', () => ({
  api: {
    pauseRun: (...args: unknown[]) => pauseRun(...args),
    resumeRun: (...args: unknown[]) => resumeRun(...args),
  },
}))

vi.mock('../primitives/Icon.js', () => ({
  default: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}))

describe('PauseResumeButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pauseRun.mockResolvedValue(undefined)
    resumeRun.mockResolvedValue(undefined)
  })
  afterEach(() => { cleanup() })

  it('calls pauseRun when status is running and button is clicked', async () => {
    render(<PauseResumeButton runId="r1" status="running" />)
    const btn = screen.getByRole('button', { name: 'Pause' })
    expect((btn as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(btn)
    await waitFor(() => expect(pauseRun).toHaveBeenCalledTimes(1))
    expect(pauseRun).toHaveBeenCalledWith('r1')
    expect(resumeRun).not.toHaveBeenCalled()
  })

  it('calls resumeRun when status is paused-user and button is clicked', async () => {
    render(<PauseResumeButton runId="r1" status="paused-user" />)
    const btn = screen.getByRole('button', { name: 'Resume' })
    expect((btn as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByTestId('icon-play')).toBeTruthy()
    fireEvent.click(btn)
    await waitFor(() => expect(resumeRun).toHaveBeenCalledTimes(1))
    expect(resumeRun).toHaveBeenCalledWith('r1')
    expect(pauseRun).not.toHaveBeenCalled()
  })

  for (const status of ['paused-gate', 'done', 'failed', 'dead'] as const) {
    it(`is disabled when status is ${status} and click is a no-op`, () => {
      render(<PauseResumeButton runId="r1" status={status as RunStatus} />)
      const btn = screen.getByRole('button', { name: 'Pause' })
      expect((btn as HTMLButtonElement).disabled).toBe(true)
      expect(btn.className).toContain('active-run__btn-ghost--disabled')
      fireEvent.click(btn)
      expect(pauseRun).not.toHaveBeenCalled()
      expect(resumeRun).not.toHaveBeenCalled()
    })
  }

  it('double-click while in-flight only fires one request', async () => {
    let resolveFirst: () => void = () => undefined
    pauseRun.mockReturnValue(new Promise<void>((r) => { resolveFirst = r }))
    render(<PauseResumeButton runId="r1" status="running" />)
    const btn = screen.getByRole('button', { name: 'Pause' })
    fireEvent.click(btn)
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(pauseRun).toHaveBeenCalledTimes(1)
    await act(async () => { resolveFirst() })
  })

  it('POST failure surfaces an inline error for 4 seconds then clears', async () => {
    vi.useFakeTimers()
    try {
      pauseRun.mockRejectedValue(new Error('boom'))
      render(<PauseResumeButton runId="r1" status="running" />)
      const btn = screen.getByRole('button', { name: 'Pause' })
      await act(async () => { fireEvent.click(btn) })
      expect(screen.getByRole('alert').textContent).toBe('boom')
      await act(async () => { vi.advanceTimersByTime(4000) })
      expect(screen.queryByRole('alert')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('status-change to paused-user clears the pending flag', async () => {
    let resolveFirst: () => void = () => undefined
    pauseRun.mockReturnValue(new Promise<void>((r) => { resolveFirst = r }))
    const { rerender } = render(<PauseResumeButton runId="r1" status="running" />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect((screen.getByRole('button', { name: 'Pause' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<PauseResumeButton runId="r1" status="paused-user" />)
    const resumeBtn = screen.getByRole('button', { name: 'Resume' }) as HTMLButtonElement
    expect(resumeBtn.disabled).toBe(false)
    await act(async () => { resolveFirst() })
  })
})
