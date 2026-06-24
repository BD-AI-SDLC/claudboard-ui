import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// ── Top-level mock so vitest hoisting works correctly ─────────────────────────
const mockGetRunEvents = vi.fn<() => Promise<object[]>>()

vi.mock('../../api/client.js', () => ({
  api: { getRunEvents: mockGetRunEvents },
}))

// Import hook after the mock is registered
const { useRunStream } = await import('../useRunStream.js')

// ── Fake WebSocket ────────────────────────────────────────────────────────────
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  readyState = 1
  url: string

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(_data: string) {}
  close() { this.onclose?.() }

  emit(event: object) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function phaseStart(num: number, t = `2026-05-01T10:00:0${num}.000Z`) {
  return { run_id: 'r1', t, kind: 'phase-start', payload: { num, title: `Phase ${num}` } }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('useRunStream', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    mockGetRunEvents.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('seeds events from REST first, then hydrated becomes true', async () => {
    const restEvents = [phaseStart(1), phaseStart(2)]
    mockGetRunEvents.mockResolvedValue(restEvents)

    const { result } = renderHook(() => useRunStream('r1'))

    expect(result.current.hydrated).toBe(false)

    await waitFor(() => expect(result.current.hydrated).toBe(true))

    expect(result.current.events).toHaveLength(2)
    expect(result.current.events[0]!.kind).toBe('phase-start')
    expect(mockGetRunEvents).toHaveBeenCalledWith('r1')
  })

  it('drops WS replay duplicates that were already in REST history', async () => {
    const restEvents = [phaseStart(1), phaseStart(2)]
    mockGetRunEvents.mockResolvedValue(restEvents)

    const { result } = renderHook(() => useRunStream('r1'))
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    const ws = FakeWebSocket.instances[0]!
    act(() => {
      ws.emit(phaseStart(1))
      ws.emit(phaseStart(2))
    })

    expect(result.current.events).toHaveLength(2)
  })

  it('appends novel WS events that were not in REST history', async () => {
    mockGetRunEvents.mockResolvedValue([phaseStart(1)])

    const { result } = renderHook(() => useRunStream('r1'))
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    const ws = FakeWebSocket.instances[0]!
    act(() => {
      ws.emit(phaseStart(2))
    })

    expect(result.current.events).toHaveLength(2)
    expect(result.current.events[1]!.kind).toBe('phase-start')
  })

  it('hydrated flips to true even when REST returns empty array', async () => {
    mockGetRunEvents.mockResolvedValue([])

    const { result } = renderHook(() => useRunStream('r1'))
    expect(result.current.hydrated).toBe(false)

    await waitFor(() => expect(result.current.hydrated).toBe(true))
    expect(result.current.events).toHaveLength(0)
  })
})
