import { describe, it, expect } from 'vitest'
import { runKindLabel } from '../runKindLabel.js'
import type { RunKind } from '@bosch-sdlc/protocol'

describe('runKindLabel', () => {
  it.each<[RunKind, string]>([
    ['feature',             'Feature workflow'],
    ['prereq',              'Prerequisite setup'],
    ['claudboard-analyse',  'Claudboard analyse'],
    ['claudboard-generate', 'Claudboard generate'],
    ['claudboard-workflow', 'Claudboard workflow'],
  ])('%s → %s', (kind, expected) => {
    expect(runKindLabel(kind)).toBe(expected)
  })

  it('undefined → default fallback', () => {
    expect(runKindLabel(undefined)).toBe('Run in progress')
  })

  it('unknown kind string → default fallback', () => {
    expect(runKindLabel('unknown-kind' as RunKind)).toBe('Run in progress')
  })

  it('claudboard-refresh → Claudboard refresh (forward-compatible, not yet a RunKind)', () => {
    expect(runKindLabel('claudboard-refresh' as RunKind)).toBe('Claudboard refresh')
  })

  it('claudboard-techdebt → Claudboard techdebt (forward-compatible, not yet a RunKind)', () => {
    expect(runKindLabel('claudboard-techdebt' as RunKind)).toBe('Claudboard techdebt')
  })
})
