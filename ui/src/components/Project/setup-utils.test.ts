import { describe, it, expect } from 'vitest'
import type { PrereqRecord } from '@bosch-sdlc/protocol'
import {
  deriveVisualState,
  deriveFoundationStates,
  deriveMaintenanceStates,
  foundationDone,
} from './setup-utils.js'

function makePrereq(overrides: Partial<PrereqRecord> = {}): PrereqRecord {
  return {
    id: 'test',
    repoId: 'proj-1',
    cmd: 'analyse',
    state: 'done',
    lastRun: '2026-05-25T00:00:00Z',
    duration: 194000,
    cost: 42,
    output: '.claude/reports/claudboard-analysis.md',
    staleReason: null,
    ...overrides,
  }
}

describe('deriveVisualState', () => {
  it('returns running when isRunning is true', () => {
    const prereq = makePrereq({ state: 'done' })
    expect(deriveVisualState(prereq, {}, [], true)).toBe('running')
  })

  it('returns done when state is done and lastRun is non-null', () => {
    const prereq = makePrereq({ state: 'done', lastRun: '2026-05-25T00:00:00Z' })
    expect(deriveVisualState(prereq, {}, [], false)).toBe('done')
  })

  it('returns done-imported when state is done and lastRun is null', () => {
    const prereq = makePrereq({ state: 'done', lastRun: null })
    expect(deriveVisualState(prereq, {}, [], false)).toBe('done-imported')
  })

  it('returns stale when state is stale', () => {
    const prereq = makePrereq({ state: 'stale' })
    expect(deriveVisualState(prereq, {}, [], false)).toBe('stale')
  })

  it('returns locked when deps are not met', () => {
    const allPrereqs: Record<string, PrereqRecord> = {
      analyse: makePrereq({ cmd: 'analyse', state: 'missing' }),
    }
    expect(deriveVisualState(undefined, allPrereqs, ['analyse'], false)).toBe('locked')
  })

  it('returns next when deps are met and state is missing', () => {
    const allPrereqs: Record<string, PrereqRecord> = {
      analyse: makePrereq({ cmd: 'analyse', state: 'done' }),
    }
    expect(deriveVisualState(undefined, allPrereqs, ['analyse'], false)).toBe('next')
  })

  it('returns next when prereq state is missing and no deps', () => {
    const prereq = makePrereq({ state: 'missing' })
    expect(deriveVisualState(prereq, {}, [], false)).toBe('next')
  })
})

describe('deriveFoundationStates', () => {
  it('returns exactly one next card (the first incomplete)', () => {
    const prereqs: Record<string, PrereqRecord> = {
      analyse: makePrereq({ cmd: 'analyse', state: 'done' }),
    }
    const states = deriveFoundationStates(prereqs, {})
    const nextCards = states.filter(s => s.visualState === 'next')
    expect(nextCards).toHaveLength(1)
    expect(nextCards[0]!.def.id).toBe('generate')
  })

  it('marks all cards after the first incomplete as locked', () => {
    const prereqs: Record<string, PrereqRecord> = {
      analyse: makePrereq({ cmd: 'analyse', state: 'done' }),
    }
    const states = deriveFoundationStates(prereqs, {})
    expect(states[0]!.visualState).toBe('done')
    expect(states[1]!.visualState).toBe('next')
    expect(states[2]!.visualState).toBe('locked')
  })

  it('returns all done when everything is complete', () => {
    const prereqs: Record<string, PrereqRecord> = {
      analyse: makePrereq({ cmd: 'analyse', state: 'done' }),
      generate: makePrereq({ cmd: 'generate', state: 'done' }),
      'workflow': makePrereq({ cmd: 'workflow', state: 'done' }),
    }
    const states = deriveFoundationStates(prereqs, {})
    expect(states.every(s => s.visualState === 'done')).toBe(true)
  })

  it('shows first card as next when nothing is done', () => {
    const states = deriveFoundationStates({}, {})
    expect(states[0]!.visualState).toBe('next')
    expect(states[1]!.visualState).toBe('locked')
    expect(states[2]!.visualState).toBe('locked')
  })

  it('shows running state when a card is actively running', () => {
    const prereqs: Record<string, PrereqRecord> = {
      analyse: makePrereq({ cmd: 'analyse', state: 'done' }),
    }
    const states = deriveFoundationStates(prereqs, { generate: true })
    expect(states[1]!.visualState).toBe('running')
  })

  it('shows done-imported for imported prereqs', () => {
    const prereqs: Record<string, PrereqRecord> = {
      analyse: makePrereq({ cmd: 'analyse', state: 'done', lastRun: null }),
      generate: makePrereq({ cmd: 'generate', state: 'done' }),
      'workflow': makePrereq({ cmd: 'workflow', state: 'done' }),
    }
    const states = deriveFoundationStates(prereqs, {})
    expect(states[0]!.visualState).toBe('done-imported')
    expect(states[1]!.visualState).toBe('done')
    expect(states[2]!.visualState).toBe('done')
  })
})

describe('deriveMaintenanceStates', () => {
  it('derives states independently — both can be next simultaneously', () => {
    const prereqs: Record<string, PrereqRecord> = {
      analyse: makePrereq({ cmd: 'analyse', state: 'done' }),
      generate: makePrereq({ cmd: 'generate', state: 'done' }),
    }
    const states = deriveMaintenanceStates(prereqs, {})
    expect(states[0]!.visualState).toBe('next')   // refresh (depends on generate)
    expect(states[1]!.visualState).toBe('next')   // techdebt (depends on analyse)
  })

  it('shows locked when deps are not met', () => {
    const states = deriveMaintenanceStates({}, {})
    expect(states[0]!.visualState).toBe('locked')  // refresh needs generate
    expect(states[1]!.visualState).toBe('locked')  // techdebt needs analyse
  })

  it('shows stale for stale prereqs', () => {
    const prereqs: Record<string, PrereqRecord> = {
      analyse: makePrereq({ cmd: 'analyse', state: 'done' }),
      generate: makePrereq({ cmd: 'generate', state: 'done' }),
      refresh: makePrereq({ cmd: 'refresh', state: 'stale' }),
    }
    const states = deriveMaintenanceStates(prereqs, {})
    expect(states[0]!.visualState).toBe('stale')
  })
})

describe('foundationDone', () => {
  it('returns true when all three ops are done', () => {
    expect(
      foundationDone({
        analyse: makePrereq({ cmd: 'analyse', state: 'done' }),
        generate: makePrereq({ cmd: 'generate', state: 'done' }),
        'workflow': makePrereq({ cmd: 'workflow', state: 'done' }),
      }),
    ).toBe(true)
  })

  it('returns false when any op is missing', () => {
    expect(foundationDone({})).toBe(false)
    expect(
      foundationDone({
        analyse: makePrereq({ cmd: 'analyse', state: 'done' }),
        generate: makePrereq({ cmd: 'generate', state: 'missing' }),
        'workflow': makePrereq({ cmd: 'workflow', state: 'done' }),
      }),
    ).toBe(false)
  })

  it('returns false when all ops are missing', () => {
    expect(
      foundationDone({
        analyse: makePrereq({ cmd: 'analyse', state: 'missing' }),
        generate: makePrereq({ cmd: 'generate', state: 'missing' }),
        'workflow': makePrereq({ cmd: 'workflow', state: 'missing' }),
      }),
    ).toBe(false)
  })
})
