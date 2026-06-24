import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { WsEvent } from '@bosch-sdlc/protocol'
import PrereqInterview from './PrereqInterview.js'

vi.mock('../../api/client.js', () => ({
  api: {
    submitCliAnswer: vi.fn().mockResolvedValue({ ok: true }),
  },
}))

vi.mock('../../hooks/useRunStream.js', () => ({
  useRunStream: vi.fn(() => ({ events: [] as WsEvent[], hydrated: true })),
}))

async function getMocks() {
  const apiMod = await import('../../api/client.js')
  const hookMod = await import('../../hooks/useRunStream.js')
  return { api: apiMod.api, useRunStream: hookMod.useRunStream as ReturnType<typeof vi.fn> }
}

function buildEvent(toolUseId: string, question = 'q?', options = [{ label: 'a' }, { label: 'b' }], header = 'group'): WsEvent {
  return {
    run_id: 'run-1',
    t: new Date().toISOString(),
    kind: 'interactive-question',
    payload: { toolUseId, questions: [{ question, header, options }] },
  }
}

describe('PrereqInterview', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { cleanup() })

  it('renders nothing when no interactive-question events have arrived', async () => {
    const { useRunStream } = await getMocks()
    useRunStream.mockReturnValue({ events: [], hydrated: true })
    const { container } = render(<PrereqInterview runId="run-1" cmd="workflow" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a pending card when an interactive-question event arrives', async () => {
    const { useRunStream } = await getMocks()
    useRunStream.mockReturnValue({ events: [buildEvent('toolu_a', 'Which branch prefixes?')], hydrated: true })
    render(<PrereqInterview runId="run-1" cmd="workflow" />)
    expect(screen.getByText('Which branch prefixes?')).toBeDefined()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    // Both the header count and the per-card chip say "question 1" — assert
    // the card-level chip exists by its more specific group text.
    expect(screen.getByText(/question 1 · group/i)).toBeDefined()
  })

  it('submitting an option calls submitCliAnswer with the chosen label and collapses the card', async () => {
    const { useRunStream, api } = await getMocks()
    useRunStream.mockReturnValue({ events: [buildEvent('toolu_a')], hydrated: true })
    render(<PrereqInterview runId="run-1" cmd="workflow" />)

    fireEvent.click(screen.getAllByRole('radio')[0]!)
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(api.submitCliAnswer).toHaveBeenCalledWith('run-1', {
        toolUseId: 'toolu_a',
        answers: [{ answer: 'a' }],
      })
    })
    // After successful submit, the card collapses → answer summary visible.
    await waitFor(() => {
      expect(screen.getByText(/→ ✓ a/)).toBeDefined()
    })
  })

  it('renders sequential questions as one collapsed + one pending', async () => {
    const { useRunStream } = await getMocks()
    const ev1 = buildEvent('toolu_a', 'first?')
    const ev2 = buildEvent('toolu_b', 'second?')

    // First render with only ev1.
    useRunStream.mockReturnValue({ events: [ev1], hydrated: true })
    const view = render(<PrereqInterview runId="run-1" cmd="x" />)
    fireEvent.click(screen.getAllByRole('radio')[0]!)
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    await waitFor(() => expect(screen.getByText(/→ ✓ a/)).toBeDefined())

    // Now both events have arrived — re-render with the updated event list.
    useRunStream.mockReturnValue({ events: [ev1, ev2], hydrated: true })
    view.rerender(<PrereqInterview runId="run-1" cmd="x" />)

    expect(screen.getByText('second?')).toBeDefined()
    expect(screen.getByText(/→ ✓ a/)).toBeDefined() // first stays collapsed
    expect(screen.getByText(/question 2 · group/i)).toBeDefined()
  })

  it('Skip POSTs answers: []', async () => {
    const { useRunStream, api } = await getMocks()
    useRunStream.mockReturnValue({ events: [buildEvent('toolu_a')], hydrated: true })
    render(<PrereqInterview runId="run-1" cmd="x" />)

    fireEvent.click(screen.getByRole('button', { name: /skip/i }))

    await waitFor(() => {
      expect(api.submitCliAnswer).toHaveBeenCalledWith('run-1', {
        toolUseId: 'toolu_a',
        answers: [],
      })
    })
    await waitFor(() => expect(screen.getByText(/\(skipped\)/i)).toBeDefined())
  })

  it('surfaces an inline error when submitCliAnswer rejects', async () => {
    const { useRunStream, api } = await getMocks()
    ;(api.submitCliAnswer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('409 Conflict: Run has exited'),
    )
    useRunStream.mockReturnValue({ events: [buildEvent('toolu_a')], hydrated: true })
    render(<PrereqInterview runId="run-1" cmd="x" />)

    fireEvent.click(screen.getAllByRole('radio')[0]!)
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Run has exited/)
    })
    // Card stays pending — Submit button is visible again
    expect(screen.getByRole('button', { name: /submit/i })).toBeDefined()
  })
})
