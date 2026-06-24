/**
 * Tests POST /api/runs/:id/cli-answer — the endpoint that routes user answers
 * back to a running prereq CLI subprocess via the in-memory registry.
 *
 * submitCliAnswer is mocked at module boundary so each test can script its
 * return value and assert the right status code/body mapping.
 */

import { jest } from '@jest/globals'
import Database from 'better-sqlite3'

let testDb: Database.Database
let mockSubmit = jest.fn<(runId: string, toolUseId: string, answers: Array<{ answer: string }>) => unknown>()

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

jest.unstable_mockModule('../run/event-log.js', () => ({
  appendEvent: jest.fn(),
  readEvents: jest.fn(() => []),
}))

jest.unstable_mockModule('../prereq/cli-runner.js', () => ({
  runPrereqViaCli: jest.fn(() => Promise.resolve()),
  downgradeToFailed: jest.fn(),
  submitCliAnswer: (runId: string, toolUseId: string, answers: Array<{ answer: string }>) =>
    mockSubmit(runId, toolUseId, answers),
}))

const { createApp } = await import('../app.js')
import request from 'supertest'

function buildTestDb(): Database.Database {
  return new Database(':memory:')
}

beforeEach(() => {
  testDb = buildTestDb()
  mockSubmit = jest.fn()
})

afterEach(() => {
  testDb.close()
})

describe('POST /api/runs/:id/cli-answer', () => {
  it('returns 200 with { ok: true } and forwards the payload to submitCliAnswer', async () => {
    mockSubmit.mockReturnValue({ ok: true })

    const app = createApp()
    const res = await request(app)
      .post('/api/runs/run-1/cli-answer')
      .send({ toolUseId: 'toolu_a', answers: [{ answer: 'choice one' }] })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(mockSubmit).toHaveBeenCalledWith('run-1', 'toolu_a', [{ answer: 'choice one' }])
  })

  it('returns 400 when toolUseId is missing', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/runs/run-1/cli-answer')
      .send({ answers: [{ answer: 'x' }] })

    expect(res.status).toBe(400)
    expect(mockSubmit).not.toHaveBeenCalled()
  })

  it('returns 400 when answers is not an array', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/runs/run-1/cli-answer')
      .send({ toolUseId: 'toolu_a', answers: 'nope' })

    expect(res.status).toBe(400)
  })

  it('returns 400 when an answer item is malformed', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/runs/run-1/cli-answer')
      .send({ toolUseId: 'toolu_a', answers: [{ wrongField: 'x' }] })

    expect(res.status).toBe(400)
  })

  it('returns 404 with "Run not found" when submitCliAnswer reports unknown-run', async () => {
    mockSubmit.mockReturnValue({ ok: false, reason: 'unknown-run' })

    const app = createApp()
    const res = await request(app)
      .post('/api/runs/nope/cli-answer')
      .send({ toolUseId: 'toolu_a', answers: [] })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Run not found' })
  })

  it('returns 404 with "Tool use id not pending for this run" when submitCliAnswer reports unknown-tool-use', async () => {
    mockSubmit.mockReturnValue({ ok: false, reason: 'unknown-tool-use' })

    const app = createApp()
    const res = await request(app)
      .post('/api/runs/run-1/cli-answer')
      .send({ toolUseId: 'toolu_old', answers: [] })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Tool use id not pending for this run' })
  })

  it('returns 409 with "Run has exited" when submitCliAnswer reports run-exited', async () => {
    mockSubmit.mockReturnValue({ ok: false, reason: 'run-exited' })

    const app = createApp()
    const res = await request(app)
      .post('/api/runs/run-1/cli-answer')
      .send({ toolUseId: 'toolu_a', answers: [{ answer: 'a' }] })

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'Run has exited' })
  })

  it('accepts an empty answers array (skip semantics)', async () => {
    mockSubmit.mockReturnValue({ ok: true })

    const app = createApp()
    const res = await request(app)
      .post('/api/runs/run-1/cli-answer')
      .send({ toolUseId: 'toolu_a', answers: [] })

    expect(res.status).toBe(200)
    expect(mockSubmit).toHaveBeenCalledWith('run-1', 'toolu_a', [])
  })
})
