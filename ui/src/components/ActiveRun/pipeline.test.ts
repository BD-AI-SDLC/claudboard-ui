import { describe, it, expect } from 'vitest'
import { buildPipelineFromEvents } from './ActiveRun.js'
import type { WsEvent } from '@bosch-sdlc/protocol'

const RUN_ID = 'test-run'
const T0 = '2026-05-20T10:00:00.000Z'
const T1 = '2026-05-20T10:01:00.000Z'
const T2 = '2026-05-20T10:02:00.000Z'

function phaseStart(num: number, t = T0): WsEvent {
  return { run_id: RUN_ID, t, kind: 'phase-start', payload: { num, title: `Phase ${num}` } }
}


function checkpointStart(num: number, title: string, t = T1): WsEvent {
  return { run_id: RUN_ID, t, kind: 'checkpoint-start', payload: { num, title } }
}

function checkpointComplete(num: number, t = T2): WsEvent {
  return { run_id: RUN_ID, t, kind: 'checkpoint-complete', payload: { num } }
}

const PHASE_TEMPLATE_TITLES = [
  'Ticket · Clarify · Specify · Plan',
  'Create Branch',
  'Develop and Test',
  'Commit',
  'Review',
  'PR Creation',
  'Finalize JIRA',
]

describe('buildPipelineFromEvents', () => {
  it('8.2 timer stability: startedAt is stable across multiple calls', () => {
    const events: WsEvent[] = [phaseStart(1, T0)]
    const result1 = buildPipelineFromEvents(events, 'feature')
    const result2 = buildPipelineFromEvents(events, 'feature')
    const phase1a = result1.find((p) => p.num === 1)!
    const phase1b = result2.find((p) => p.num === 1)!
    expect(phase1a.startedAt).toBe(new Date(T0).getTime())
    expect(phase1b.startedAt).toBe(phase1a.startedAt)
  })

  it('8.3 checkpoint propagation: currentCheckpoint is set and main agent op matches title', () => {
    const events: WsEvent[] = [
      phaseStart(1, T0),
      checkpointStart(1, '1a. Clarify scope', T1),
    ]
    const phases = buildPipelineFromEvents(events, 'feature')
    const ph = phases.find((p) => p.num === 1)!
    expect(ph.currentCheckpoint).toBe('1a. Clarify scope')
    const mainAgent = ph.agents.find((a) => a.name === 'main')!
    expect(mainAgent.op).toBe('1a. Clarify scope')
  })

  it('8.4 checkpoint clearing: currentCheckpoint cleared and main agent falls back to orchestrating', () => {
    const events: WsEvent[] = [
      phaseStart(1, T0),
      checkpointStart(1, '1a. Clarify scope', T1),
      checkpointComplete(1, T2),
    ]
    const phases = buildPipelineFromEvents(events, 'feature')
    const ph = phases.find((p) => p.num === 1)!
    expect(ph.currentCheckpoint).toBeUndefined()
    const mainAgent = ph.agents.find((a) => a.name === 'main')!
    expect(mainAgent.op).toBe('orchestrating')
  })

  it('8.5 main row presence: phase-start alone produces a main agent with op orchestrating', () => {
    const events: WsEvent[] = [phaseStart(1, T0)]
    const phases = buildPipelineFromEvents(events, 'feature')
    const ph = phases.find((p) => p.num === 1)!
    const mainAgent = ph.agents.find((a) => a.name === 'main')
    expect(mainAgent).toBeDefined()
    expect(mainAgent!.op).toBe('orchestrating')
  })

  it('8.6 pending phase has no agents: empty event list leaves all 7 phases with agents.length === 0', () => {
    const phases = buildPipelineFromEvents([], 'feature')
    expect(phases).toHaveLength(7)
    for (const ph of phases) {
      expect(ph.agents).toHaveLength(0)
    }
  })

  it('claudboard-analyse run produces no phantom phases', () => {
    const phases = buildPipelineFromEvents([], 'claudboard-analyse')
    expect(phases).toHaveLength(0)
  })

  it('prereq run produces only emitted phases', () => {
    const phaseStartEvent: WsEvent = {
      run_id: RUN_ID, t: T0, kind: 'phase-start', payload: { num: 1, title: 'Install Skill' }
    }
    const phaseCompleteEvent: WsEvent = {
      run_id: RUN_ID, t: T2, kind: 'phase-complete', payload: { num: 1 }
    }
    const phases = buildPipelineFromEvents([phaseStartEvent, phaseCompleteEvent], 'prereq')
    expect(phases).toHaveLength(1)
    const ph0 = phases[0]!
    expect(ph0.num).toBe(1)
    expect(ph0.title).toBe('Install Skill')
    expect(ph0.status).toBe('done')
    for (const title of PHASE_TEMPLATE_TITLES) {
      expect(phases.some(p => p.title === title)).toBe(false)
    }
  })

  it('undefined kind preserves feature template (hydration window)', () => {
    const phases = buildPipelineFromEvents([], undefined)
    expect(phases).toHaveLength(7)
    for (const [i, title] of PHASE_TEMPLATE_TITLES.entries()) {
      const ph = phases[i]!
      expect(ph.title).toBe(title)
    }
  })
})
