import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { parseServerTime, formatStreamTime } from './time.js'

describe('parseServerTime', () => {
  it('parses ISO with Z suffix', () => {
    const d = parseServerTime('2026-06-05T14:30:45.123Z')
    expect(isNaN(d.getTime())).toBe(false)
    expect(d.toISOString()).toBe('2026-06-05T14:30:45.123Z')
  })

  it('parses ISO with + offset', () => {
    const d = parseServerTime('2026-06-05T16:30:45+02:00')
    expect(isNaN(d.getTime())).toBe(false)
    expect(d.toISOString()).toBe('2026-06-05T14:30:45.000Z')
  })

  it('parses legacy "YYYY-MM-DD HH:MM:SS" as UTC', () => {
    const d = parseServerTime('2026-06-05 14:30:45')
    expect(isNaN(d.getTime())).toBe(false)
    expect(d.toISOString()).toBe('2026-06-05T14:30:45.000Z')
  })

  it('returns NaN Date for empty string', () => {
    const d = parseServerTime('')
    expect(isNaN(d.getTime())).toBe(true)
  })

  it('returns NaN Date for garbage string', () => {
    const d = parseServerTime('not-a-date')
    expect(isNaN(d.getTime())).toBe(true)
  })
})

describe('formatStreamTime', () => {
  const origTZ = process.env.TZ

  beforeAll(() => {
    process.env.TZ = 'Europe/Berlin'
  })

  afterAll(() => {
    if (origTZ === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = origTZ
    }
  })

  it('formats a UTC moment as HH:MM:SS in local time (Berlin = UTC+2 in summer)', () => {
    // 2026-06-05T12:30:45Z → 14:30:45 in Europe/Berlin (CEST = UTC+2)
    const result = formatStreamTime('2026-06-05T12:30:45.000Z')
    expect(result).toHaveLength(8)
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(result).toBe('14:30:45')
  })

  it('returns — for empty string', () => {
    expect(formatStreamTime('')).toBe('—')
  })

  it('returns — for garbage string', () => {
    expect(formatStreamTime('garbage')).toBe('—')
  })
})
