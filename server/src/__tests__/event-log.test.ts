import { jest } from '@jest/globals'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

// Override homedir so event-log writes to a temp dir
const tempBase = join(tmpdir(), `event-log-test-${randomUUID()}`)
jest.unstable_mockModule('node:os', () => ({
  homedir: () => tempBase,
}))

const { appendEvent, readEvents } = await import('../run/event-log.js')

function makeEvent(num: number) {
  return {
    run_id: 'run-1',
    t: new Date(Date.now() + num).toISOString(),
    kind: 'phase-start' as const,
    payload: { num, title: `Phase ${num}` },
  }
}

describe('event-log', () => {
  beforeAll(() => {
    mkdirSync(tempBase, { recursive: true })
  })

  afterAll(() => {
    try { rmSync(tempBase, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('(a) three appends produce a 3-line file in order', () => {
    const runId = randomUUID()
    const ev1 = makeEvent(1)
    const ev2 = makeEvent(2)
    const ev3 = makeEvent(3)

    appendEvent(runId, ev1)
    appendEvent(runId, ev2)
    appendEvent(runId, ev3)

    const events = readEvents(runId)
    expect(events).toHaveLength(3)
    expect(events[0]).toEqual(ev1)
    expect(events[1]).toEqual(ev2)
    expect(events[2]).toEqual(ev3)
  })

  it('(b) 500 appends persist all 500 lines (more than the 200-event ring buffer)', () => {
    const runId = randomUUID()
    for (let i = 0; i < 500; i++) {
      appendEvent(runId, makeEvent(i))
    }
    const events = readEvents(runId)
    expect(events).toHaveLength(500)
    expect((events[0] as { payload: { num: number } }).payload.num).toBe(0)
    expect((events[499] as { payload: { num: number } }).payload.num).toBe(499)
  })

  it('(c) readEvents on a missing file returns []', () => {
    const events = readEvents(`no-such-run-${randomUUID()}`)
    expect(events).toEqual([])
  })
})
