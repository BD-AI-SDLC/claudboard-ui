import { createGateDeferred, resolveGateDeferred, hasOpenGate } from '../deferred.js'

describe('gate deferred lifecycle', () => {
  test('approve resolves the deferred with approved', async () => {
    const promise = createGateDeferred('run-1', 'gate-1')
    const resolved = resolveGateDeferred('run-1', 'gate-1', { result: 'approved' })
    expect(resolved).toBe(true)
    const result = await promise
    expect(result).toEqual({ result: 'approved' })
  })

  test('reject with changes resolves with rejection payload', async () => {
    const promise = createGateDeferred('run-2', 'gate-2')
    resolveGateDeferred('run-2', 'gate-2', { result: 'rejected', changes: 'Add more scenarios' })
    const result = await promise
    expect(result).toEqual({ result: 'rejected', changes: 'Add more scenarios' })
  })

  test('disconnect mid-gate: deferred stays pending until resolved', async () => {
    const promise = createGateDeferred('run-3', 'gate-3')
    // simulate disconnect — no resolution yet
    expect(hasOpenGate('run-3', 'gate-3')).toBe(true)
    // later resolve
    resolveGateDeferred('run-3', 'gate-3', { result: 'approved' })
    await promise
    expect(hasOpenGate('run-3', 'gate-3')).toBe(false)
  })
})
