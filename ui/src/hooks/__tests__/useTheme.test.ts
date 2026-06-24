import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTheme } from '../useTheme.js'

type MqListener = (e: { matches: boolean }) => void

function makeMockMq(matches: boolean) {
  const listeners: MqListener[] = []
  return {
    get matches() { return matches },
    set matches(v: boolean) { matches = v },
    addEventListener: (_: string, fn: MqListener) => listeners.push(fn),
    removeEventListener: (_: string, fn: MqListener) => {
      const i = listeners.indexOf(fn)
      if (i !== -1) listeners.splice(i, 1)
    },
    fire: (newMatches: boolean) => {
      matches = newMatches
      listeners.forEach((fn) => fn({ matches: newMatches }))
    },
  }
}

describe('useTheme', () => {
  let mockMq: ReturnType<typeof makeMockMq>
  let originalMatchMedia: typeof window.matchMedia

  beforeEach(() => {
    originalMatchMedia = window.matchMedia
    mockMq = makeMockMq(false)
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => {
        if (query === '(prefers-color-scheme: light)') return mockMq as unknown as MediaQueryList
        return { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia })
    delete (document.documentElement.dataset as Record<string, string>).theme
  })

  it('defaults to dark when matchMedia is undefined', () => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: undefined })
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
  })

  it('reads light when OS prefers light', () => {
    mockMq.matches = true
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
  })

  it('updates on OS change when no override', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')

    act(() => mockMq.fire(true))
    expect(result.current.theme).toBe('light')

    act(() => mockMq.fire(false))
    expect(result.current.theme).toBe('dark')
  })

  it('ignores OS change after user override', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')

    act(() => result.current.setTheme('light'))
    expect(result.current.theme).toBe('light')

    act(() => mockMq.fire(false))
    expect(result.current.theme).toBe('light')
  })

  it('override is session-scoped — separate renderHook calls start fresh', () => {
    const { result: r1 } = renderHook(() => useTheme())
    act(() => r1.current.setTheme('light'))
    expect(r1.current.theme).toBe('light')

    const { result: r2 } = renderHook(() => useTheme())
    expect(r2.current.theme).toBe('dark')
  })
})
