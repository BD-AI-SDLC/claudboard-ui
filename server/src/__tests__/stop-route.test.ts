/**
 * Tests POST /api/runs/:id/stop — the route layer around stopRun().
 *
 * stopRun() itself is mocked at module boundary so this file exercises only
 * the HTTP status-code mapping: 200 on { ok:true }, 404 on 'not-found',
 * 409 on every other reason. The driver-level behaviour is covered by
 * run/__tests__/stop.test.ts.
 */

import { jest } from '@jest/globals'
import Database from 'better-sqlite3'

let testDb: Database.Database
let mockStop = jest.fn<(runId: string) => { ok: boolean; reason?: string }>()

jest.unstable_mockModule('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(() => (async function* () {})()),
  createSdkMcpServer: () => ({ instance: {} }),
  tool: (name: string, _d: unknown, _s: unknown, handler: unknown) => ({ name, handler }),
}))

jest.unstable_mockModule('../ws-server.js', () => ({
  broadcast: jest.fn(),
  subscribe: jest.fn().mockReturnValue(() => {}),
}))

jest.unstable_mockModule('../db.js', () => ({
  getDb: () => testDb,
}))

jest.unstable_mockModule('../run/driver.js', () => ({
  runFeature: jest.fn(),
  setPausedUser: jest.fn(),
  resumeRun: jest.fn(),
  stopRun: (runId: string) => mockStop(runId),
}))

const { createApp } = await import('../app.js')
import request from 'supertest'

beforeEach(() => {
  testDb = new Database(':memory:')
  mockStop = jest.fn()
})

afterEach(() => {
  testDb.close()
})

describe('POST /api/runs/:id/stop', () => {
  test('returns 200 { cancelled: true } when stopRun returns ok:true', async () => {
    mockStop.mockReturnValue({ ok: true })
    const app = createApp()
    const res = await request(app).post('/api/runs/r1/stop').send()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ cancelled: true })
    expect(mockStop).toHaveBeenCalledWith('r1')
  })

  test('returns 404 with reason when stopRun returns not-found', async () => {
    mockStop.mockReturnValue({ ok: false, reason: 'not-found' })
    const app = createApp()
    const res = await request(app).post('/api/runs/nope/stop').send()
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'not-found' })
  })

  test('returns 409 when stopRun returns prereq-runs-cannot-be-stopped', async () => {
    mockStop.mockReturnValue({ ok: false, reason: 'prereq-runs-cannot-be-stopped' })
    const app = createApp()
    const res = await request(app).post('/api/runs/p1/stop').send()
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'prereq-runs-cannot-be-stopped' })
  })

  test.each(['already-done', 'already-failed', 'already-dead', 'already-cancelled'])(
    'returns 409 when stopRun returns %s',
    async (reason) => {
      mockStop.mockReturnValue({ ok: false, reason })
      const app = createApp()
      const res = await request(app).post('/api/runs/r-x/stop').send()
      expect(res.status).toBe(409)
      expect(res.body).toEqual({ error: reason })
    },
  )
})
